import { executeYnabImport, getYnabImportStatus, parseYnab } from '@/api/import-ynab';
import { useImportJobProgress } from '@/composable/use-import-job-progress';
import { useWizardSteps } from '@/composable/use-wizard-steps';
import { i18n } from '@/i18n';
import { useAccountsStore } from '@/stores/accounts';
import { useCategoriesStore } from '@/stores/categories/categories';
import { useCurrenciesStore } from '@/stores/currencies';
import { useTagsStore } from '@/stores/tags';
import {
  SSE_EVENT_TYPES,
  type YnabAccountMapping,
  type YnabImportProgress,
  type YnabParseResult,
} from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/**
 * Wizard steps, mirroring the CSV/Wallet importers' key-based step machine:
 *  - `upload`  — file upload + parse
 *  - `preview` — preview + per-account currency picker
 *  - `results` — execute progress + done summary (swaps Execute↔Done by status)
 */
export type YnabImportStepKey = 'upload' | 'preview' | 'results';

/** Every step in canonical order. All are always visible. */
const ALL_STEP_KEYS: readonly YnabImportStepKey[] = ['upload', 'preview', 'results'];

export const useImportYnabStore = defineStore('importYnab', () => {
  const queryClient = useQueryClient();

  const uploadedFile = ref<File | null>(null);
  const parsedResult = ref<YnabParseResult | null>(null);

  /** Keyed by `YnabParseAccount.originalName`. */
  const accountPicks = ref<YnabAccountMapping>({});

  // ---- Wizard step state ----

  /**
   * Key-based step machine. All three steps are always visible (YNAB has no
   * conditional step), so no visibility predicate is passed.
   */
  const {
    currentStepKey,
    completedStepKeys,
    visibleSteps,
    goToStep,
    markStepCompleted,
    reset: resetSteps,
  } = useWizardSteps<YnabImportStepKey>({ stepKeys: ALL_STEP_KEYS });

  /**
   * SSE + status-poll watchdog for the running import. Owns the live `progress`
   * and the terminal `executeError`. On success the wizard advances to the done
   * screen; lost contact bounces back to the picker step so the user can retry.
   */
  const jobProgress = useImportJobProgress<YnabImportProgress>({
    sseEventType: SSE_EVENT_TYPES.YNAB_IMPORT_PROGRESS,
    fetchStatus: getYnabImportStatus,
    onComplete: async () => {
      // Already on the `results` step; DoneStep renders once the progress status
      // flips to completed. Completion only needs to refresh caches.
      // Invalidate every cached TanStack query so transactions/payees/budgets etc.
      // pick up the just-imported rows.
      queryClient.invalidateQueries();
      // Pinia-backed lists (accounts, categories, tags, currencies) are not
      // wired into TanStack — refetch each one explicitly so sidebars and
      // pickers don't keep their pre-import snapshot.
      await Promise.allSettled([
        useAccountsStore().refetchAccounts(),
        useCategoriesStore().loadCategories({ force: true }),
        useTagsStore().loadTags(),
        useCurrenciesStore().loadCurrencies({ force: true }),
      ]);
    },
    // On failure the wizard stays on the execute step, where the failed status
    // callout (with the server's error message) is rendered.
    onFailure: () => {},
    onLostContact: () => {
      goToStep('preview');
    },
  });
  const progress = jobProgress.progress;
  /** Terminal watchdog error (lost contact / expired job) for the execute step. */
  const executeError = jobProgress.executeError;

  const isParsing = ref(false);
  const parseError = ref<string | null>(null);

  // Internal execute machinery — components never read these.
  let fileContent: string | null = null;

  const skippedAccountNames = computed<string[]>(() =>
    Object.entries(accountPicks.value)
      .filter(([, value]) => value.skip)
      .map(([name]) => name),
  );

  const canExecute = computed(() => {
    if (!parsedResult.value) return false;
    // Every account the user keeps must have resolved to a valid 3-letter ISO
    // currency code before the worker can boot user currencies and create the
    // row. Skipped accounts are never created, so their currency is irrelevant.
    for (const acc of parsedResult.value.accounts) {
      const mapping = accountPicks.value[acc.originalName];
      if (!mapping) return false;
      if (!mapping.skip && mapping.currencyCode.length !== 3) return false;
    }
    return true;
  });

  /** Keeps `currencyCode` so unskipping restores the picker's previous value. */
  function toggleAccountSkip({ accountName }: { accountName: string }) {
    const mapping = accountPicks.value[accountName];
    if (!mapping) return;
    accountPicks.value[accountName] = { ...mapping, skip: !mapping.skip };
  }

  async function parseFile(file: File) {
    uploadedFile.value = file;
    fileContent = await file.text();
    isParsing.value = true;
    parseError.value = null;
    try {
      const { result } = await parseYnab({ fileContent });
      parsedResult.value = result;
      // Seed account picks with the parser's currency guesses so the user
      // only has to overrule misses, not type every currency from scratch.
      const seeded: YnabAccountMapping = {};
      for (const acc of result.accounts) {
        seeded[acc.originalName] = { currencyCode: acc.detectedCurrency ?? '' };
      }
      accountPicks.value = seeded;
      markStepCompleted('upload');
      goToStep('preview');
    } catch (err) {
      parseError.value = err instanceof Error ? err.message : i18n.global.t('errors.api.unexpectedError');
      throw err;
    } finally {
      isParsing.value = false;
    }
  }

  async function execute() {
    if (!fileContent || !canExecute.value) return;
    executeError.value = null;

    let response: Awaited<ReturnType<typeof executeYnabImport>>;
    try {
      response = await executeYnabImport({
        fileContent,
        accountMapping: accountPicks.value,
      });
    } catch (err) {
      // The call never started the job — keep the user on the picker step (2)
      // so they can correct the input and retry.
      executeError.value = err instanceof Error ? err.message : i18n.global.t('errors.api.unexpectedError');
      return;
    }

    // Job accepted: only now advance to the progress step and arm the watchdog.
    markStepCompleted('preview');
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

  function reset() {
    uploadedFile.value = null;
    parsedResult.value = null;
    accountPicks.value = {};
    progress.value = null;
    resetSteps();
    isParsing.value = false;
    parseError.value = null;
    executeError.value = null;
    fileContent = null;
    jobProgress.stop();
  }

  return {
    uploadedFile,
    parsedResult,
    accountPicks,
    progress,
    currentStepKey,
    completedStepKeys,
    visibleSteps,
    goToStep,
    isParsing,
    parseError,
    executeError,
    canExecute,
    skippedAccountNames,
    toggleAccountSkip,
    parseFile,
    execute,
    reset,
  };
});
