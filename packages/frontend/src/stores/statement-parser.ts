import {
  type StatementDetectDuplicatesResponse,
  detectStatementDuplicates,
  estimateStatementCost,
  executeStatementImport,
  extractStatementTransactions,
  getStatementImportStatus,
} from '@/api/import-export';
import { loadTransactions } from '@/api/transactions';
import { fileToBase64 } from '@/common/utils/file-to-base64';
import { useImportJobProgress } from '@/composable/use-import-job-progress';
import { useWizardSteps } from '@/composable/use-wizard-steps';
import { i18n } from '@/i18n';
import { isApiErrorWithCode } from '@/js/errors';
import { trackAnalyticsEvent } from '@/lib/posthog';
import {
  API_ERROR_CODES,
  type AccountModel,
  type ExtractedMetadata,
  type ExtractedTransaction,
  SSE_EVENT_TYPES,
  type StatementCostEstimate,
  type StatementCostEstimateFailure,
  type StatementExtractionResult,
  type StatementImportProgress,
  type StatementTextExtractionErrorCode,
  type TransactionModel,
} from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { useOnboardingStore } from './onboarding';

/**
 * Statement import wizard: upload + estimate + extract (per file, one AI call each),
 * account selection, duplicate review (existing accounts only), import.
 */

/**
 * Wizard steps, mirroring the CSV/Wallet importers' key-based step machine:
 *  - `upload`  — file upload + AI extraction
 *  - `account` — select an existing account or create a new one
 *  - `review`  — review/exclude detected duplicates (existing accounts only)
 *  - `results` — confirm + execute import, then show the summary
 */
export type StatementParserStepKey = 'upload' | 'account' | 'review' | 'results';

/** Every step in canonical order. `review` is filtered out for new accounts. */
const ALL_STEP_KEYS: readonly StatementParserStepKey[] = ['upload', 'account', 'review', 'results'];

/** One selected file plus its per-file estimate and extraction outcome. */
export interface StatementFileEntry {
  /** `name:size:lastModified` — how a re-selection of the same file is recognised. */
  id: string;
  file: File;
  fileBase64: string;
  /** Password for an encrypted file, sent with both the estimate and the extraction. */
  password: string | null;
  costEstimate: StatementCostEstimate | null;
  estimateError: string | null;
  /** Lets the upload step ask for a password instead of only showing the message. */
  estimateErrorCode: StatementTextExtractionErrorCode | null;
  extraction: StatementExtractionResult | null;
  extractionError: string | null;
}

export type StatementFileStatus = 'pending' | 'estimated' | 'estimateFailed' | 'extracted' | 'extractionFailed';

export function entryStatus({ entry }: { entry: StatementFileEntry }): StatementFileStatus {
  if (entry.extraction) return 'extracted';
  if (entry.extractionError) return 'extractionFailed';
  if (entry.estimateError) return 'estimateFailed';
  if (entry.costEstimate) return 'estimated';
  return 'pending';
}

function fileKey({ file }: { file: File }): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export const useStatementParserStore = defineStore('statementParser', () => {
  const queryClient = useQueryClient();

  // Account selection state — declared up front because the wizard's `review`
  // step is only visible for existing accounts, so the key-based step machine's
  // visibility predicate (below) reads `isNewAccount`.
  const selectedAccount = ref<AccountModel | null>(null);
  const isNewAccount = ref(false);

  // Step tracking — key-based machine shared with the CSV/Wallet importers.
  const {
    currentStepKey,
    completedStepKeys,
    visibleSteps,
    goToStep,
    goBack,
    markStepCompleted,
    reset: resetSteps,
  } = useWizardSteps<StatementParserStepKey>({
    stepKeys: ALL_STEP_KEYS,
    // The duplicate-review step only applies to imports into an existing account;
    // a brand-new account has nothing to detect duplicates against, so it's hidden
    // and navigation skips straight from account selection to import.
    isStepVisible: (key) => (key === 'review' ? !isNewAccount.value : true),
  });

  // Step 1: File upload — one entry per selected statement, in selection order.
  const fileEntries = ref<StatementFileEntry[]>([]);

  // Step 2: Cost estimate. Per-file results live on the entries; these track
  // which file the batch is currently working through, for progress reporting.
  const isEstimating = ref(false);
  const estimatingFileId = ref<string | null>(null);

  // Step 3: Extraction (per-file results also live on the entries).
  const isExtracting = ref(false);
  const extractingFileId = ref<string | null>(null);

  // Step 4: Account selection (selectedAccount + isNewAccount declared above,
  // ahead of the step machine that reads them).
  // Manual currency selection (used when AI doesn't detect currency)
  const manualCurrency = ref<string | null>(null);

  // Step 5: Duplicate detection
  const isDetectingDuplicates = ref(false);
  const duplicates = ref<StatementDetectDuplicatesResponse['duplicates']>([]);
  // A failed check leaves `duplicates` empty, which reads exactly like a clean statement.
  const duplicateDetectionError = ref<string | null>(null);
  // Existing transactions in the account within the statement date range
  const existingTransactions = ref<TransactionModel[]>([]);
  // Set of transaction indices that user wants to import anyway (override duplicate detection)
  const overriddenDuplicateIndices = ref<Set<number>>(new Set());
  // Set of transaction indices that user wants to exclude (manual exclusion)
  const excludedTransactionIndices = ref<Set<number>>(new Set());

  // Step 6: Import execution. The execute endpoint enqueues a background job, so
  // the terminal summary lives on `progress` (the `completed` branch) and the
  // watchdog below follows the job over SSE + a status poll.
  const isEnqueuing = ref(false);
  /** Set only when the request that starts the job never lands, which is the one
   *  case where re-submitting cannot duplicate rows. */
  const importError = ref<string | null>(null);

  const jobProgress = useImportJobProgress<StatementImportProgress>({
    sseEventType: SSE_EVENT_TYPES.STATEMENT_IMPORT_PROGRESS,
    fetchStatus: getStatementImportStatus,
    onComplete: () => {
      // Note: import_completed is tracked on the backend for reliability
      useOnboardingStore().completeTask('import-csv');
      queryClient.invalidateQueries();
    },
    // The results step renders the failure from `importJobError`. Rows may still
    // have been committed before the job died, so the caches are refreshed too.
    onFailure: () => queryClient.invalidateQueries(),
    onLostContact: () => queryClient.invalidateQueries(),
  });

  /** A job that started and then failed, or one this device lost contact with.
   *  Rows may already have landed, so the UI must not offer a plain retry. */
  const importJobError = computed(() => {
    if (jobProgress.progress.value?.status === 'failed') {
      // A failed job with an empty message would read as "no error" and drop the
      // user back on the ready-to-import screen with a live Import button.
      return jobProgress.progress.value.error || i18n.global.t('pages.statementParser.importResults.failedTitle');
    }
    return jobProgress.executeError.value;
  });

  const isImporting = computed(
    () =>
      // Lost contact and an expired job leave `progress` on queued/running, so
      // without this the spinner outlives the error forever.
      !importJobError.value &&
      (isEnqueuing.value ||
        jobProgress.progress.value?.status === 'queued' ||
        jobProgress.progress.value?.status === 'running'),
  );
  const importResult = computed(() =>
    jobProgress.progress.value?.status === 'completed' ? jobProgress.progress.value.summary : null,
  );

  // The wizard's index space: duplicates, exclusions and `skipIndices` are positions
  // in this array, and it is exactly what is POSTed to detect-duplicates and execute.
  const mergedTransactions = computed<ExtractedTransaction[]>(() =>
    fileEntries.value.flatMap((entry) => entry.extraction?.transactions ?? []),
  );

  /** Source file name for each merged index. */
  const transactionSources = computed<string[]>(() =>
    fileEntries.value.flatMap((entry) => (entry.extraction?.transactions ?? []).map(() => entry.file.name)),
  );

  const entriesWithStatus = ({ status }: { status: StatementFileStatus }) =>
    fileEntries.value.filter((entry) => entryStatus({ entry }) === status);

  const extractedEntries = computed(() => entriesWithStatus({ status: 'extracted' }));
  const extractionFailures = computed(() => entriesWithStatus({ status: 'extractionFailed' }));
  const estimateFailures = computed(() => entriesWithStatus({ status: 'estimateFailed' }));
  const pendingEstimateEntries = computed(() => entriesWithStatus({ status: 'pending' }));
  // Estimate and extract share the server-side text extraction: a file whose
  // estimate failed (or never ran) is not sent to the paid extract call.
  const extractableEntries = computed(() => entriesWithStatus({ status: 'estimated' }));

  /** Rows the extraction recognised but could not use, summed over the batch. */
  const droppedRowCount = computed(() =>
    extractedEntries.value.reduce((sum, entry) => sum + entry.extraction!.droppedRowCount, 0),
  );

  /** Distinct non-empty values a metadata getter yields across parsed files. */
  function distinctMetadata({ pick }: { pick: (metadata: ExtractedMetadata) => string | undefined }): string[] {
    const values = extractedEntries.value
      .map((entry) => pick(entry.extraction!.metadata))
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    return [...new Set(values)];
  }

  const detectedBankNames = computed(() => distinctMetadata({ pick: (metadata) => metadata.bankName }));
  const detectedCurrencies = computed(() => distinctMetadata({ pick: (metadata) => metadata.currencyCode }));

  // A detected value is only reported when every file that identified one agrees;
  // the whole selection lands in one account, so a conflict is the user's to resolve.
  const detectedBankName = computed(() =>
    detectedBankNames.value.length === 1 ? detectedBankNames.value[0] : undefined,
  );
  const detectedCurrency = computed(() =>
    detectedCurrencies.value.length === 1 ? detectedCurrencies.value[0] : undefined,
  );
  const hasCurrencyConflict = computed(() => detectedCurrencies.value.length > 1);

  /**
   * Effective currency - either AI-detected or manually selected by user
   */
  const effectiveCurrency = computed(() => detectedCurrency.value || manualCurrency.value);

  // Model/key fields come from the first estimate (identical for every file).
  // `estimatedCostUsd` is null if any file's price is unknown: a partial sum would understate.
  const costEstimateTotals = computed(() => {
    const estimates = fileEntries.value
      .map((entry) => entry.costEstimate)
      .filter((estimate): estimate is StatementCostEstimate => estimate !== null);
    if (!estimates.length) return null;

    const first = estimates[0]!;
    const hasUnpricedFile = estimates.some((estimate) => estimate.estimatedCostUsd === null);

    return {
      ...first,
      fileCount: estimates.length,
      estimatedInputTokens: estimates.reduce((sum, estimate) => sum + estimate.estimatedInputTokens, 0),
      estimatedOutputTokens: estimates.reduce((sum, estimate) => sum + estimate.estimatedOutputTokens, 0),
      estimatedCostUsd: hasUnpricedFile
        ? null
        : estimates.reduce((sum, estimate) => sum + (estimate.estimatedCostUsd ?? 0), 0),
    };
  });

  /**
   * Get the date range of extracted transactions for fetching existing transactions
   */
  const extractedDateRange = computed(() => {
    if (!mergedTransactions.value.length) return null;

    const dates = mergedTransactions.value.map((tx) => tx.date.split(' ')[0]!);
    const sortedDates = [...dates].sort();

    return {
      startDate: sortedDates[0]!,
      endDate: sortedDates[sortedDates.length - 1]!,
    };
  });

  const duplicateIndices = computed(() => new Set(duplicates.value.map((d) => d.transactionIndex)));

  /**
   * Transactions that will be imported (excluding duplicates and manually excluded)
   */
  const transactionsToImport = computed(() =>
    mergedTransactions.value.filter((_, index) => {
      // Exclude if manually excluded
      if (excludedTransactionIndices.value.has(index)) return false;

      // Include if duplicate but overridden
      if (duplicateIndices.value.has(index) && overriddenDuplicateIndices.value.has(index)) return true;

      // Exclude if duplicate and not overridden
      if (duplicateIndices.value.has(index)) return false;

      return true;
    }),
  );

  /**
   * Get indices of transactions to skip during import
   */
  const skipIndices = computed(() => {
    const indices: number[] = [];

    mergedTransactions.value.forEach((_, index) => {
      // Skip if manually excluded
      if (excludedTransactionIndices.value.has(index)) {
        indices.push(index);
        return;
      }

      // Skip if duplicate and not overridden
      if (duplicateIndices.value.has(index) && !overriddenDuplicateIndices.value.has(index)) {
        indices.push(index);
      }
    });

    return indices;
  });

  const importSummary = computed(() => ({
    total: mergedTransactions.value.length,
    toImport: transactionsToImport.value.length,
    duplicates: duplicates.value.length,
    excluded: excludedTransactionIndices.value.size,
    overridden: overriddenDuplicateIndices.value.size,
    files: extractedEntries.value.length,
  }));

  // Everything keyed by merged index; any change to the merged list invalidates it all.
  function clearDerivedState() {
    selectedAccount.value = null;
    isNewAccount.value = false;
    manualCurrency.value = null;
    isDetectingDuplicates.value = false;
    duplicates.value = [];
    duplicateDetectionError.value = null;
    existingTransactions.value = [];
    overriddenDuplicateIndices.value = new Set();
    excludedTransactionIndices.value = new Set();
    isEnqueuing.value = false;
    importError.value = null;
    jobProgress.stop();
    jobProgress.progress.value = null;
    jobProgress.setExecuteError(null);
  }

  // Entries for files still selected are kept as-is so their paid-for estimate/extraction survives.
  // Returns names of files that could not be read; the store emits no user-facing strings.
  async function setFiles({ files }: { files: File[] }): Promise<{ unreadable: string[] }> {
    const existing = new Map(fileEntries.value.map((entry) => [entry.id, entry]));

    // The upload step re-validates the same list on every dropzone emit; resetting
    // the wizard for an identical selection would discard the user's duplicate decisions.
    const unchanged =
      files.length === fileEntries.value.length &&
      files.every((file, i) => fileKey({ file }) === fileEntries.value[i]!.id);
    if (unchanged) return { unreadable: [] };

    const next: StatementFileEntry[] = [];
    const unreadable: string[] = [];

    for (const file of files) {
      const id = fileKey({ file });
      const kept = existing.get(id);
      if (kept) {
        next.push(kept);
        continue;
      }

      try {
        next.push({
          id,
          file,
          fileBase64: await fileToBase64({ file }),
          password: null,
          costEstimate: null,
          estimateError: null,
          estimateErrorCode: null,
          extraction: null,
          extractionError: null,
        });
      } catch {
        unreadable.push(file.name);
      }
    }

    fileEntries.value = next;
    clearDerivedState();
    resetSteps();
    if (mergedTransactions.value.length) markStepCompleted('upload');

    return { unreadable };
  }

  /** Sets the password for one file and clears its estimate failure so `estimateCosts` retries it. */
  function setDocumentPassword({ id, password }: { id: string; password: string | null }) {
    const entry = fileEntries.value.find((candidate) => candidate.id === id);
    if (!entry) return;

    entry.password = password;
    entry.estimateError = null;
    entry.estimateErrorCode = null;
  }

  /** Estimates pending files only; already-estimated files are never re-sent. */
  async function estimateCosts() {
    if (isEstimating.value || !fileEntries.value.length) return;

    isEstimating.value = true;

    try {
      for (const entry of pendingEstimateEntries.value) {
        estimatingFileId.value = entry.id;

        try {
          const result = await estimateStatementCost({
            fileBase64: entry.fileBase64,
            password: entry.password ?? undefined,
          });

          if ('success' in result && (result as StatementCostEstimateFailure).success === false) {
            const failure = result as StatementCostEstimateFailure;
            entry.estimateError = failure.error?.message || failure.suggestion || 'Failed to analyze file';
            entry.estimateErrorCode = failure.textExtraction.success
              ? null
              : (failure.textExtraction.errorCode ?? null);
          } else {
            // A successful estimate and an estimate error never coexist on an entry.
            entry.costEstimate = result as StatementCostEstimate;
            entry.estimateError = null;
            entry.estimateErrorCode = null;
          }
        } catch (error) {
          entry.estimateError = error instanceof Error ? error.message : 'Failed to estimate cost';
          entry.estimateErrorCode = null;
        }
      }
    } finally {
      estimatingFileId.value = null;
      isEstimating.value = false;
    }
  }

  /** Extracts estimated files one at a time; a failure is recorded on its entry and the rest continue. */
  async function extractAll() {
    if (isExtracting.value || !fileEntries.value.length) return;

    isExtracting.value = true;

    let extractedSomething = false;

    try {
      for (const entry of extractableEntries.value) {
        extractingFileId.value = entry.id;

        try {
          // A successful extraction and an extraction error never coexist on an entry.
          entry.extraction = await extractStatementTransactions({
            fileBase64: entry.fileBase64,
            password: entry.password ?? undefined,
          });
          entry.extractionError = null;
          extractedSomething = true;

          trackAnalyticsEvent({
            event: 'ai_feature_used',
            properties: { feature: 'statement_parser' },
          });
        } catch (error) {
          entry.extractionError = error instanceof Error ? error.message : 'Failed to extract transactions';
        }
      }
    } finally {
      extractingFileId.value = null;
      isExtracting.value = false;
    }

    // A newly extracted file re-bases every later merged index, so duplicates,
    // exclusions and overrides no longer refer to the rows they were made against.
    if (extractedSomething) {
      clearDerivedState();
      resetSteps();
    }

    // Unless every file extracted, the upload step stays visible so the partial
    // batch is explicit; its Continue button advances.
    if (mergedTransactions.value.length) {
      markStepCompleted('upload');
      if (extractedEntries.value.length === fileEntries.value.length) goToStep('account');
    }
  }

  /** Clears one phase's recorded failures so the next `estimateCosts` / `extractAll` retries them. */
  function clearFailures({ phase }: { phase: 'estimate' | 'extract' }) {
    fileEntries.value.forEach((entry) => {
      if (phase === 'estimate') {
        entry.estimateError = null;
        entry.estimateErrorCode = null;
      } else {
        entry.extractionError = null;
      }
    });
  }

  function selectAccount({ account, isNew = false }: { account: AccountModel; isNew?: boolean }) {
    selectedAccount.value = account;
    isNewAccount.value = isNew;

    // Reset duplicate detection when account changes
    duplicates.value = [];
    duplicateDetectionError.value = null;
    overriddenDuplicateIndices.value = new Set();
  }

  function setManualCurrency({ currencyCode }: { currencyCode: string | null }) {
    manualCurrency.value = currencyCode;
  }

  function clearSelectedAccount() {
    selectedAccount.value = null;
    isNewAccount.value = false;
    duplicates.value = [];
    duplicateDetectionError.value = null;
    overriddenDuplicateIndices.value = new Set();
  }

  async function proceedFromAccountSelection() {
    if (!selectedAccount.value || !mergedTransactions.value.length) return;

    markStepCompleted('account');

    if (isNewAccount.value) {
      // New account: the `review` step is hidden (nothing to detect duplicates
      // against), so jump straight to import.
      goToStep('results');
    } else {
      // Detect duplicates for existing accounts.
      goToStep('review');
      await detectDuplicates();
    }
  }

  async function detectDuplicates() {
    if (!selectedAccount.value || !mergedTransactions.value.length) return;

    isDetectingDuplicates.value = true;
    duplicateDetectionError.value = null;
    duplicates.value = [];
    existingTransactions.value = [];

    try {
      // Fetch duplicates and existing transactions in parallel. The merged list
      // goes over the wire as one batch, so the returned `transactionIndex`
      // values are already merged indices.
      const duplicatesPromise = detectStatementDuplicates({
        accountId: selectedAccount.value.id,
        transactions: mergedTransactions.value,
      });

      // Fetch existing transactions for the date range
      const dateRange = extractedDateRange.value;
      const existingPromise = dateRange
        ? loadTransactions({
            offset: 0,
            limit: 1000, // Reasonable limit for a statement period
            accountIds: [selectedAccount.value.id],
            from: dateRange.startDate,
            to: dateRange.endDate,
          })
        : Promise.resolve([]);

      const [duplicatesResult, existingResult] = await Promise.all([duplicatesPromise, existingPromise]);

      duplicates.value = duplicatesResult.duplicates;
      existingTransactions.value = existingResult;

      // Mark duplicate review step as completed
      markStepCompleted('review');
    } catch (error) {
      // A missing duplicate check does not block the import, so record the reason
      // instead of throwing.
      duplicateDetectionError.value = error instanceof Error ? error.message : 'Failed to check for duplicates';
    } finally {
      isDetectingDuplicates.value = false;
    }
  }

  function toggleDuplicateOverride({ transactionIndex }: { transactionIndex: number }) {
    if (overriddenDuplicateIndices.value.has(transactionIndex)) {
      overriddenDuplicateIndices.value.delete(transactionIndex);
    } else {
      overriddenDuplicateIndices.value.add(transactionIndex);
    }
    // Trigger reactivity
    overriddenDuplicateIndices.value = new Set(overriddenDuplicateIndices.value);
  }

  function toggleTransactionExclusion({ transactionIndex }: { transactionIndex: number }) {
    if (excludedTransactionIndices.value.has(transactionIndex)) {
      excludedTransactionIndices.value.delete(transactionIndex);
    } else {
      excludedTransactionIndices.value.add(transactionIndex);
    }
    // Trigger reactivity
    excludedTransactionIndices.value = new Set(excludedTransactionIndices.value);
  }

  function proceedToImport() {
    markStepCompleted('review');
    goToStep('results');
  }

  async function executeImport() {
    if (!selectedAccount.value || !mergedTransactions.value.length) return;
    // The Import button only disappears on the next tick, so a double click
    // would otherwise fire two POSTs and import every row twice.
    if (isImporting.value) return;

    isEnqueuing.value = true;
    importError.value = null;
    jobProgress.setExecuteError(null);

    try {
      const { jobId } = await executeStatementImport({
        accountId: selectedAccount.value.id,
        transactions: mergedTransactions.value,
        skipIndices: skipIndices.value,
      });

      jobProgress.start({
        initialProgress: { jobId, status: 'queued', processedCount: 0, totalCount: 0 },
      });
    } catch (error) {
      // A conflict means a job of this user's is already running: follow that one
      // rather than dead-ending on an error the user cannot act on.
      const inFlightJobId = isApiErrorWithCode(error, API_ERROR_CODES.conflict)
        ? (error.data.details?.jobId as string | undefined)
        : undefined;
      if (inFlightJobId) {
        jobProgress.start({
          initialProgress: { jobId: inFlightJobId, status: 'queued', processedCount: 0, totalCount: 0 },
        });
        return;
      }
      importError.value = error instanceof Error ? error.message : 'Failed to import transactions';
    } finally {
      isEnqueuing.value = false;
    }
  }

  function reset() {
    resetSteps();
    fileEntries.value = [];
    isEstimating.value = false;
    estimatingFileId.value = null;
    isExtracting.value = false;
    extractingFileId.value = null;
    clearDerivedState();
  }

  return {
    // State
    currentStepKey,
    completedStepKeys,
    visibleSteps,
    fileEntries,
    isEstimating,
    estimatingFileId,
    isExtracting,
    extractingFileId,
    selectedAccount,
    isNewAccount,
    manualCurrency,
    isDetectingDuplicates,
    duplicates,
    duplicateDetectionError,
    existingTransactions,
    overriddenDuplicateIndices,
    excludedTransactionIndices,
    isImporting,
    importResult,
    importError,
    importJobError,

    // Computed
    mergedTransactions,
    transactionSources,
    extractedEntries,
    droppedRowCount,
    extractionFailures,
    estimateFailures,
    pendingEstimateEntries,
    extractableEntries,
    costEstimateTotals,
    detectedBankName,
    detectedCurrency,
    detectedCurrencies,
    hasCurrencyConflict,
    effectiveCurrency,
    extractedDateRange,
    duplicateIndices,
    transactionsToImport,
    skipIndices,
    importSummary,

    // Step navigation
    goToStep,
    goBack,

    // Actions
    setFiles,
    setDocumentPassword,
    estimateCosts,
    extractAll,
    clearFailures,
    selectAccount,
    setManualCurrency,
    clearSelectedAccount,
    proceedFromAccountSelection,
    detectDuplicates,
    toggleDuplicateOverride,
    toggleTransactionExclusion,
    proceedToImport,
    executeImport,
    reset,
  };
});
