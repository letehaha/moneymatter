import {
  detectBudgetBakersWalletDuplicates as apiDetectBudgetBakersWalletDuplicates,
  executeBudgetBakersWalletImport,
  getBudgetBakersWalletImportStatus,
  parseBudgetBakersWallet,
} from '@/api/import-budget-bakers-wallet';
import { useCategoryMappingPresets } from '@/composable/use-category-mapping-presets';
import { useImportJobProgress } from '@/composable/use-import-job-progress';
import { useRecalculateBalanceToggle } from '@/composable/use-recalculate-balance-toggle';
import { useResolveMapping } from '@/composable/use-resolve-mapping';
import { useWizardSteps } from '@/composable/use-wizard-steps';
import { i18n } from '@/i18n';
import { captureException } from '@/lib/sentry';
import { flattenCategories } from '@/pages/import-export/utils/flatten-categories';
import { useAccountsStore } from '@/stores/accounts';
import { useCategoriesStore } from '@/stores/categories/categories';
import { useCurrenciesStore } from '@/stores/currencies';
import { useTagsStore } from '@/stores/tags';
import {
  BUDGET_BAKERS_WALLET_CSV_DELIMITER,
  BUDGET_BAKERS_WALLET_MAX_ROWS,
  SSE_EVENT_TYPES,
  type CategoryMappingConfig,
  type CategoryMappingPreset,
  type CategoryMappingValue,
  type DuplicateMatch,
  type BudgetBakersWalletAccountMapping,
  type BudgetBakersWalletImportProgress,
  type BudgetBakersWalletParseResult,
} from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/**
 * Wizard steps, mirroring the CSV importer's key-based step machine. The Wallet
 * CSV format is fixed, so there is no "map columns" step — the four steps are:
 *  - `upload`  — file upload + parse
 *  - `resolve` — per-account + per-category mapping decisions
 *  - `review`  — duplicate review + import summary
 *  - `results` — execute progress + done summary
 *
 * Unlike CSV, every step is always visible (no conditional resolve step).
 */
export type BudgetBakersWalletImportStepKey = 'upload' | 'resolve' | 'review' | 'results';

/** Every step in canonical order. All are always visible. */
const ALL_STEP_KEYS: readonly BudgetBakersWalletImportStepKey[] = ['upload', 'resolve', 'review', 'results'];

/** The Wallet export layout is fixed, so every import shares one remembered-preset key. */
const CATEGORY_PRESET_FINGERPRINT = 'budget-bakers-wallet';

/**
 * Store-internal form shape for one account decision. Wider than the wire type
 * (`BudgetBakersWalletAccountMappingValue`): a `link-existing` row may not have a target
 * chosen yet, expressed as `accountId: undefined` — the explicit "unselected"
 * state. Using `undefined` (rather than an empty string) keeps the illegal
 * "linked to nothing" state out of the wire shape and lets validity checks key
 * off the explicit state instead of truthiness of a string.
 *
 * Converted to `BudgetBakersWalletAccountMappingValue` at submit time; unselected rows are
 * blocked from being posted by `toWireAccountMapping`.
 */
type BudgetBakersWalletAccountFormValue =
  | { action: 'create-new'; currencyCode: string; currentBalance: number | null }
  | { action: 'link-existing'; accountId: string | undefined }
  | { action: 'skip' };

/** Form-level account decisions keyed by `WalletParseAccount.originalName`. */
type BudgetBakersWalletAccountFormMapping = Record<string, BudgetBakersWalletAccountFormValue>;

export const useImportBudgetBakersWalletStore = defineStore('import-budget-bakers-wallet', () => {
  const queryClient = useQueryClient();

  // ---- Wizard step state ----

  /**
   * Key-based step machine. All four steps are always visible (the Wallet CSV
   * format is fixed, so there is no conditional "map columns" step), so no
   * visibility predicate is passed.
   */
  const {
    currentStepKey,
    completedStepKeys,
    visibleSteps,
    goToStep,
    goNext,
    goBack,
    markStepCompleted,
    reset: resetSteps,
  } = useWizardSteps<BudgetBakersWalletImportStepKey>({ stepKeys: ALL_STEP_KEYS });

  // ---- Core parse state ----

  /**
   * Files the user selected, in selection order. Multiple Wallet exports are
   * merged client-side into one canonical CSV (`fileContent`) before parsing, so
   * the rest of the pipeline stays single-file-aware. Recorded only after a
   * successful merge + parse so a failure leaves the store on a clean slate.
   */
  const uploadedFiles = ref<File[]>([]);
  const parsedResult = ref<BudgetBakersWalletParseResult | null>(null);

  // ---- Account-mapping state ----

  /**
   * Per-account decision keyed by `WalletParseAccount.originalName`. Seeded
   * after a successful parse with `create-new` + the detected currency; the
   * resolve step lets the user switch individual accounts to `link-existing` or
   * `skip`.
   *
   * Default: `create-new` with `currentBalance: null` (no explicit target —
   * the final balance equals whatever the imported transactions sum to).
   */
  const accountMapping = ref<BudgetBakersWalletAccountFormMapping>({});

  // ---- Category-mapping state ----

  /**
   * Per-category decision keyed by the verbatim Wallet `category` value
   * (`WalletParseCategory.name`). Each category is mapped to an existing
   * category (`link-existing`) or created fresh (`create-new`). The parser
   * already strips the transfer marker, so it never appears here.
   */
  const categoryMapping = ref<CategoryMappingConfig>({});

  // ---- Duplicate-detection state ----

  /** Raw duplicate matches returned by the detect-duplicates endpoint. */
  const duplicates = ref<DuplicateMatch[]>([]);
  /**
   * Row indices the user has "un-marked" (i.e. wants to import anyway despite
   * being detected as a duplicate). Mirrors the csv `import-export` store pattern.
   */
  const unmarkedDuplicateIndices = ref<Set<number>>(new Set());
  /** Row indices that will actually be skipped on execute (all detected
   *  duplicates minus any the user chose to import anyway). */
  const skipDuplicateIndices = computed<number[]>(() =>
    duplicates.value.filter((d) => !unmarkedDuplicateIndices.value.has(d.rowIndex)).map((d) => d.rowIndex),
  );

  // ---- Progress / execute state ----

  /**
   * SSE + status-poll watchdog for the running import. Owns the live `progress`
   * and the terminal `executeError`. On success the wizard is already on the
   * `results` step, so completion only refreshes caches; lost contact bounces
   * back to `review` so the user can retry.
   */
  const jobProgress = useImportJobProgress<BudgetBakersWalletImportProgress>({
    sseEventType: SSE_EVENT_TYPES.BUDGET_BAKERS_WALLET_IMPORT_PROGRESS,
    fetchStatus: getBudgetBakersWalletImportStatus,
    onComplete: async () => {
      // Invalidate every cached TanStack query so transactions/analytics/balances
      // pick up the just-imported rows.
      queryClient.invalidateQueries();
      // Pinia-backed lists (accounts, categories, tags, currencies) are not
      // wired into TanStack — refetch each one explicitly so sidebars and
      // pickers don't keep their pre-import snapshot. Each refetch is guarded so
      // one failing list neither rejects the handler nor blocks the others.
      await Promise.allSettled([
        useAccountsStore()
          .refetchAccounts()
          .catch((error) =>
            captureException({ error, context: { scope: 'import-budget-bakers-wallet:post-import-accounts' } }),
          ),
        useCategoriesStore()
          .loadCategories({ force: true })
          .catch((error) =>
            captureException({ error, context: { scope: 'import-budget-bakers-wallet:post-import-categories' } }),
          ),
        useTagsStore()
          .loadTags()
          .catch((error) =>
            captureException({ error, context: { scope: 'import-budget-bakers-wallet:post-import-tags' } }),
          ),
        useCurrenciesStore()
          .loadCurrencies({ force: true })
          .catch((error) =>
            captureException({ error, context: { scope: 'import-budget-bakers-wallet:post-import-currencies' } }),
          ),
      ]);
    },
    // On failure the wizard stays on the results step, where the failed status
    // callout (with the server's error message) is rendered.
    onFailure: () => {},
    onLostContact: () => goToStep('review'),
  });
  const progress = jobProgress.progress;

  // ---- Balance recalculation toggle ----

  // Review-step checkbox backed by the persisted `import.recalculateAccountBalance`
  // user setting; the chosen value is PATCHed back after execute accepts the job.
  const {
    recalculateBalance,
    settingsLoading: recalculateBalanceSettingLoading,
    settingsLoadFailed: recalculateBalanceSettingLoadFailed,
    persistRecalculateBalanceSetting,
    resetOverride: resetRecalculateBalanceOverride,
  } = useRecalculateBalanceToggle({ sentryScope: 'import-budget-bakers-wallet:persist-recalculate-balance' });

  // ---- Loading / error flags ----

  const parseError = ref<string | null>(null);
  const isDetectingDuplicates = ref(false);
  const detectError = ref<string | null>(null);
  /** Terminal watchdog error (lost contact / expired job) for the results step. */
  const executeError = jobProgress.executeError;

  // ---- Internal execute machinery — components never read these ----

  let fileContent: string | null = null;

  // ---- Resolve helpers feeding the shared resolve engine ----

  /** Detected currency for each source account, keyed by its original name. Rebuilt once per parse result. */
  const accountCurrencyByName = computed<Map<string, string>>(() => {
    const map = new Map<string, string>();
    for (const account of parsedResult.value?.accounts ?? []) {
      map.set(account.originalName, account.currency);
    }
    return map;
  });

  /** Builds a `create-new` account form value carrying the account's detected currency. */
  const buildAccountCreateNew = ({
    currency,
  }: {
    currency: string | undefined;
  }): BudgetBakersWalletAccountFormValue => ({
    action: 'create-new',
    currencyCode: currency ?? '',
    currentBalance: null,
  });

  const skippedAccountNames = computed<string[]>(() =>
    Object.entries(accountMapping.value)
      .filter(([, value]) => value.action === 'skip')
      .map(([name]) => name),
  );

  /**
   * Source category names used by at least one row of a non-skipped account.
   * Transfers carry no category and out-of-wallet legs carry a null one, so the
   * ordinary rows are the whole picture.
   */
  const resolvableCategoryNames = computed<string[]>(() => {
    const names = (parsedResult.value?.categories ?? []).map((category) => category.name);
    if (skippedAccountNames.value.length === 0) return names;

    const skipped = new Set(skippedAccountNames.value);
    const stillReferenced = new Set<string>();
    for (const tx of parsedResult.value?.transactions ?? []) {
      if (tx.categoryName && !skipped.has(tx.accountName)) stillReferenced.add(tx.categoryName);
    }
    return names.filter((name) => stillReferenced.has(name));
  });

  /** True once an account form decision is complete (create-new, skip, or linked with a chosen target). */
  const isAccountResolved = (mapping: BudgetBakersWalletAccountFormValue | undefined): boolean =>
    mapping?.action === 'create-new' ||
    mapping?.action === 'skip' ||
    (mapping?.action === 'link-existing' && mapping.accountId !== undefined);

  /** True once a category decision is complete (create-new, or linked with a chosen target). */
  const isCategoryResolved = (mapping: CategoryMappingValue | undefined): boolean =>
    mapping?.action === 'create-new' || (mapping?.action === 'link-existing' && !!mapping.categoryId);

  /**
   * Shared resolve engine (bulk actions, resolved counts, step validity,
   * duplicate-unmark toggle). The Wallet wizard has no tags and its entities are
   * always active. Account create-new entries carry the account's detected
   * currency; the `link-existing` form value uses `undefined` for "no target
   * chosen yet".
   */
  const {
    autoMatchResolveValues,
    quickMapExactMatches,
    quickCreateNewForUnmatched,
    quickAiMapCategories,
    isAiMappingCategories,
    aiMappingCategoriesError,
    resetAiMapping,
    resetResolveEntity,
    toggleDuplicateUnmark,
    accountResolvedCount,
    categoryResolvedCount,
    isResolveStepValid,
  } = useResolveMapping<BudgetBakersWalletAccountFormValue, CategoryMappingValue>({
    accounts: {
      isActive: () => true,
      getSources: () =>
        (parsedResult.value?.accounts ?? []).map((account) => ({
          name: account.originalName,
          currencyCode: account.currency || undefined,
        })),
      getTargets: () =>
        useAccountsStore().importLinkableAccounts.map((account) => ({
          id: String(account.id),
          name: account.name,
          currencyCode: account.currencyCode,
        })),
      mapping: accountMapping,
      toLink: (id) => ({ action: 'link-existing', accountId: id }),
      toCreate: (name) => buildAccountCreateNew({ currency: accountCurrencyByName.value.get(name) }),
      isResolved: isAccountResolved,
    },
    categories: {
      isActive: () => true,
      getSources: () => resolvableCategoryNames.value.map((name) => ({ name })),
      getTargets: () =>
        flattenCategories({ categories: useCategoriesStore().formattedCategories }).map((category) => ({
          id: category.id,
          name: category.name,
        })),
      mapping: categoryMapping,
      toLink: (id) => ({ action: 'link-existing', categoryId: id }),
      toCreate: () => ({ action: 'create-new' }),
      isResolved: isCategoryResolved,
    },
    unmarkedDuplicateIndices,
  });

  // ---- Remembered category mappings ----

  const {
    matchingPreset: matchingCategoryPreset,
    namedPresets: namedCategoryPresets,
    applyPreset,
    persistPreset: persistCategoryPreset,
    renamePreset: renameCategoryPreset,
    deletePreset: deleteCategoryPreset,
  } = useCategoryMappingPresets({ fingerprint: ref(CATEGORY_PRESET_FINGERPRINT) });

  const applyCategoryPreset = ({ preset }: { preset: CategoryMappingPreset }) =>
    applyPreset({ preset, categoryMapping, validSourceNames: resolvableCategoryNames.value });

  /** True when at least one account is mapped to an existing app account.
   *  Determines whether duplicate detection is meaningful. */
  const hasAnyLinkExisting = computed(() =>
    Object.values(accountMapping.value).some((m) => m.action === 'link-existing'),
  );

  // ---- Per-row mapping setters (consumed by the shared mapping tables) ----

  /**
   * Switches one account's action. `create-new` carries the account's detected
   * currency + a null balance; `link-existing` starts unselected (no target id)
   * until the user picks one; `skip` stores no payload.
   */
  function setAccountAction({ name, action }: { name: string; action: 'create-new' | 'link-existing' | 'skip' }): void {
    if (action === 'create-new') {
      accountMapping.value[name] = buildAccountCreateNew({ currency: accountCurrencyByName.value.get(name) });
    } else if (action === 'link-existing') {
      accountMapping.value[name] = { action: 'link-existing', accountId: undefined };
    } else {
      accountMapping.value[name] = { action: 'skip' };
    }
  }

  /**
   * Sets the link target for one account. A cleared picker (empty id) returns the
   * row to the unselected `link-existing` state so the resolve step stays invalid
   * until a target is chosen, matching the CSV behaviour.
   */
  function setAccountTarget({ name, accountId }: { name: string; accountId: string }): void {
    accountMapping.value[name] = { action: 'link-existing', accountId: accountId || undefined };
  }

  /**
   * Sets the desired post-import balance for a `create-new` account. Pass
   * `null` to leave the balance equal to the sum of imported transactions.
   * Decimals only — the frontend never works in cents.
   */
  function setAccountCurrentBalance({ name, currentBalance }: { name: string; currentBalance: number | null }): void {
    const existing = accountMapping.value[name];
    if (existing?.action === 'create-new') {
      existing.currentBalance = currentBalance;
    }
  }

  /** Switches one category's action (`create-new` or link-existing with an empty id). */
  function setCategoryAction({ name, action }: { name: string; action: 'create-new' | 'link-existing' }): void {
    if (action === 'create-new') {
      categoryMapping.value[name] = { action: 'create-new' };
    } else {
      categoryMapping.value[name] = { action: 'link-existing', categoryId: '' };
    }
  }

  /** Sets the link target for one category. An empty id keeps the row unresolved. */
  function setCategoryTarget({ name, categoryId }: { name: string; categoryId: string }): void {
    categoryMapping.value[name] = { action: 'link-existing', categoryId };
  }

  /**
   * Readies the resolve step: ensures the existing categories + accounts lists
   * (the link targets) are loaded, then runs a non-destructive auto-match. Each
   * fetch is independently guarded so a single failure neither aborts the rest
   * nor rejects the caller. Mirrors CSV's `prepareResolveStep`.
   */
  async function prepareResolveStep(): Promise<void> {
    const accountsStore = useAccountsStore();
    const categoriesStore = useCategoriesStore();

    const tasks: Promise<unknown>[] = [];

    if (categoriesStore.categories.length === 0) {
      tasks.push(
        categoriesStore.loadCategories().catch((error) => {
          captureException({ error, context: { scope: 'import-budget-bakers-wallet:load-categories' } });
        }),
      );
    }

    if (!accountsStore.isAccountsFetched) {
      tasks.push(
        accountsStore.refetchAccounts().catch((error) => {
          captureException({ error, context: { scope: 'import-budget-bakers-wallet:load-accounts' } });
        }),
      );
    }

    await Promise.allSettled(tasks);

    autoMatchResolveValues({ overwrite: false });
  }

  // ---- Submit-time conversion ----

  /**
   * Projects the store-internal account form mapping to the wire shape. Every
   * `link-existing` row must have a chosen target by this point (`isResolveStepValid`
   * gates the UI); an unselected one is a programming error, so this throws rather
   * than silently posting an account linked to nothing.
   */
  function toWireAccountMapping(): BudgetBakersWalletAccountMapping {
    const wire: BudgetBakersWalletAccountMapping = {};
    for (const [name, value] of Object.entries(accountMapping.value)) {
      if (value.action === 'link-existing') {
        if (value.accountId === undefined) {
          throw new Error(`Account "${name}" is set to link to an existing account but no target was selected.`);
        }
        wire[name] = { action: 'link-existing', accountId: value.accountId };
      } else {
        wire[name] = value;
      }
    }
    return wire;
  }

  // ---- Async actions ----

  async function parseFiles({ files }: { files: File[] }): Promise<void> {
    // Clear any prior backend parse error up front, before the async merge runs, so a
    // retry doesn't briefly re-render the previous error's Callout while merging.
    parseError.value = null;

    // Combine the selected Wallet exports into one canonical CSV string client-side.
    // BudgetBakers parses with a fixed ';' delimiter, so the merge re-serializes with
    // ';' rather than the default comma. Merging across files also lets transfer legs
    // split across separate exports pair up, and lets duplicate detection see the full
    // set. Throws a MergeCsvError (header mismatch, unreadable/empty file, row-limit)
    // that the upload step maps to a localized message; left to propagate here (so it
    // never reaches the catch below, which is reserved for backend parse failures).
    const { mergeCsvFiles } = await import('@/pages/import-export/utils/merge-csv-files');
    const merged = await mergeCsvFiles({
      files,
      outputDelimiter: BUDGET_BAKERS_WALLET_CSV_DELIMITER,
      maxRows: BUDGET_BAKERS_WALLET_MAX_ROWS,
    });
    fileContent = merged.combinedContent;

    try {
      const { result } = await parseBudgetBakersWallet({ fileContent });
      parsedResult.value = result;

      // Record the selection only once merge + parse have succeeded, so a failure
      // leaves the store untouched and the upload step retries from a clean slate.
      uploadedFiles.value = files;

      // Start both mappings empty and let `prepareResolveStep`'s auto-match make the
      // initial decisions: every account/category whose name exactly matches an
      // existing one links to it, and the rest fall back to create-new (accounts
      // carrying their detected currency, via the `toCreate` factory). Seeding to
      // create-new here is the abolished alternative — auto-match runs with
      // `overwrite: false` and skips rows that already hold a decision, so a
      // pre-seed would pin every row at create-new until the user manually clicked
      // "Map exact matches".
      accountMapping.value = {};
      categoryMapping.value = {};

      markStepCompleted('upload');
      goToStep('resolve');
      await prepareResolveStep();
    } catch (err) {
      parseError.value = err instanceof Error ? err.message : i18n.global.t('errors.api.unexpectedError');
      throw err;
    }
  }

  /**
   * Calls the detect-duplicates endpoint if at least one account maps to an
   * existing account (otherwise there is nothing to detect against and
   * duplicates are cleared immediately), then advances to the review step.
   */
  async function detectDuplicates(): Promise<void> {
    if (!fileContent) {
      // The parsed file content is gone — there is nothing to detect against.
      // Surface a real error and send the user back to re-upload rather than
      // silently doing nothing.
      detectError.value = i18n.global.t('pages.importExport.budgetBakersWalletImport.errors.fileMissing');
      goToStep('upload');
      return;
    }

    if (!hasAnyLinkExisting.value) {
      duplicates.value = [];
      unmarkedDuplicateIndices.value = new Set();
      markStepCompleted('resolve');
      goToStep('review');
      return;
    }

    isDetectingDuplicates.value = true;
    detectError.value = null;
    try {
      const response = await apiDetectBudgetBakersWalletDuplicates({
        fileContent,
        accountMapping: toWireAccountMapping(),
      });
      duplicates.value = response.duplicates;
      unmarkedDuplicateIndices.value = new Set();
      markStepCompleted('resolve');
      goToStep('review');
    } catch (err) {
      detectError.value = err instanceof Error ? err.message : i18n.global.t('errors.api.unexpectedError');
      throw err;
    } finally {
      isDetectingDuplicates.value = false;
    }
  }

  async function execute(): Promise<void> {
    if (!fileContent) {
      // The parsed file content is gone — the job cannot be started. Surface a
      // real error and send the user back to re-upload rather than silently
      // doing nothing when they click Import.
      jobProgress.setExecuteError(i18n.global.t('pages.importExport.budgetBakersWalletImport.errors.fileMissing'));
      goToStep('upload');
      return;
    }
    jobProgress.setExecuteError(null);

    // Stored decisions for categories hidden by an account skip must not reach the
    // backend: it would create categories no imported row references.
    const visibleCategories = new Set(resolvableCategoryNames.value);
    const categoryMappingPayload = Object.fromEntries(
      Object.entries(categoryMapping.value).filter(([name]) => visibleCategories.has(name)),
    );

    let response: Awaited<ReturnType<typeof executeBudgetBakersWalletImport>>;
    try {
      response = await executeBudgetBakersWalletImport({
        fileContent,
        accountMapping: toWireAccountMapping(),
        categoryMapping: categoryMappingPayload,
        skipDuplicateIndices: skipDuplicateIndices.value,
        recalculateBalance: recalculateBalance.value,
      });
    } catch (err) {
      // The call never started the job — keep the user on `review` (not marked
      // complete) so they can correct the input and retry.
      jobProgress.setExecuteError(err instanceof Error ? err.message : i18n.global.t('errors.api.unexpectedError'));
      return;
    }

    // Job accepted: remember the balance-recalculation choice for the next
    // import (fire-and-forget), then advance the wizard and arm the watchdog.
    persistRecalculateBalanceSetting();
    persistCategoryPreset({ mapping: categoryMappingPayload });
    markStepCompleted('review');
    goToStep('results');
    jobProgress.start({
      initialProgress: {
        jobId: response.jobId,
        status: 'queued',
        processedCount: 0,
        totalCount: 0,
      },
    });
  }

  function reset(): void {
    uploadedFiles.value = [];
    parsedResult.value = null;
    accountMapping.value = {};
    categoryMapping.value = {};
    duplicates.value = [];
    unmarkedDuplicateIndices.value = new Set();
    resetRecalculateBalanceOverride();
    progress.value = null;
    resetSteps();
    parseError.value = null;
    isDetectingDuplicates.value = false;
    detectError.value = null;
    resetAiMapping();
    jobProgress.setExecuteError(null);
    fileContent = null;
    jobProgress.stop();
  }

  return {
    // State
    uploadedFiles,
    parsedResult,
    accountMapping,
    categoryMapping,
    duplicates,
    unmarkedDuplicateIndices,
    progress,
    currentStepKey,
    completedStepKeys,
    parseError,
    isDetectingDuplicates,
    detectError,
    executeError,

    // Getters
    visibleSteps,
    accountResolvedCount,
    categoryResolvedCount,
    resolvableCategoryNames,
    skippedAccountNames,
    matchingCategoryPreset,
    namedCategoryPresets,
    isResolveStepValid,
    hasAnyLinkExisting,
    skipDuplicateIndices,
    recalculateBalance,
    recalculateBalanceSettingLoading,
    recalculateBalanceSettingLoadFailed,

    // Step navigation
    goToStep,
    goNext,
    goBack,
    markStepCompleted,
    prepareResolveStep,

    // Per-row mapping setters
    setAccountAction,
    setAccountTarget,
    setAccountCurrentBalance,
    setCategoryAction,
    setCategoryTarget,

    // Bulk actions
    autoMatchResolveValues,
    quickMapExactMatches,
    quickCreateNewForUnmatched,
    quickAiMapCategories,
    isAiMappingCategories,
    aiMappingCategoriesError,
    resetResolveEntity,
    applyCategoryPreset,
    renameCategoryPreset,
    deleteCategoryPreset,

    // Duplicate helpers
    toggleDuplicateUnmark,

    // Actions
    parseFiles,
    detectDuplicates,
    execute,
    reset,
  };
});
