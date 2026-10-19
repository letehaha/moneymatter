import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type Ref, defineComponent, ref } from 'vue';

import { useStatementParserStore } from './statement-parser';

// ----- module mocks -----

vi.mock('@/api/import-export', () => ({
  estimateStatementCost: vi.fn(),
  extractStatementTransactions: vi.fn(),
  detectStatementDuplicates: vi.fn(),
  executeStatementImport: vi.fn(),
  getStatementImportStatus: vi.fn(),
}));

// The store arms a `useImportJobProgress` watchdog at construction time. Mock it
// so the store builds without real SSE or timers, and so tests can drive the job
// state machine by writing to these refs.
let mockProgress: Ref<unknown>;
let mockExecuteError: Ref<string | null>;
let mockStart: ReturnType<typeof vi.fn>;
vi.mock('@/composable/use-import-job-progress', () => ({
  useImportJobProgress: vi.fn(() => ({
    progress: mockProgress,
    executeError: mockExecuteError,
    setExecuteError: vi.fn(),
    start: mockStart,
    stop: vi.fn(),
  })),
}));

vi.mock('@/i18n', () => ({ i18n: { global: { t: (key: string) => key } } }));

vi.mock('@/api/transactions', () => ({ loadTransactions: vi.fn() }));

vi.mock('@/lib/posthog', () => ({ trackAnalyticsEvent: vi.fn() }));

// useQueryClient is called at store construction time; hand back a shared client.
let sharedQueryClient: QueryClient;
vi.mock('@tanstack/vue-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/vue-query')>();
  return { ...actual, useQueryClient: vi.fn(() => sharedQueryClient) };
});

vi.mock('./onboarding', () => ({ useOnboardingStore: vi.fn(() => ({ completeTask: vi.fn() })) }));

// ----- helpers -----

import * as statementApi from '@/api/import-export';
import * as transactionsApi from '@/api/transactions';
import { ApiErrorResponseError } from '@/js/errors';
import {
  API_ERROR_CODES,
  type AccountModel,
  type ExtractedMetadata,
  type StatementCostEstimate,
  type StatementExtractionResult,
} from '@bt/shared/types';

const mockEstimate = vi.mocked(statementApi.estimateStatementCost);
const mockExtract = vi.mocked(statementApi.extractStatementTransactions);
const mockDetectDuplicates = vi.mocked(statementApi.detectStatementDuplicates);
const mockExecuteImport = vi.mocked(statementApi.executeStatementImport);
const mockLoadTransactions = vi.mocked(transactionsApi.loadTransactions);

const ACCOUNT = { id: 1 } as unknown as AccountModel;

const COST_ESTIMATE: StatementCostEstimate = {
  estimatedInputTokens: 1000,
  estimatedOutputTokens: 500,
  estimatedCostUsd: 0.01,
  modelId: 'model-1',
  modelName: 'Model One',
  usingUserKey: false,
  textExtraction: { success: true, characterCount: 400, pageCount: 1 },
  fileType: 'pdf',
};

const PASSWORD_FAILURE = {
  success: false as const,
  textExtraction: { success: false as const, characterCount: 0, pageCount: 1, errorCode: 'PASSWORD_REQUIRED' as const },
  fileType: 'pdf' as const,
  suggestion: 'This PDF is password-protected.',
};

const extractionWith = ({
  count,
  metadata = {},
}: {
  count: number;
  metadata?: ExtractedMetadata;
}): StatementExtractionResult => ({
  transactions: Array.from({ length: count }, (_, i) => ({
    date: '2026-01-01',
    description: `Coffee ${i}`,
    amount: 3.5,
    type: 'expense' as const,
  })),
  metadata,
  pageCount: 1,
  fileType: 'pdf',
  tokenCount: { input: 1000, output: 500 },
  droppedRowCount: 0,
});

const EXTRACTION_RESULT = extractionWith({ count: 1 });

const aPdf = (name = 'statement.pdf', lastModified = 1) =>
  new File(['%PDF-1.4 fake'], name, { type: 'application/pdf', lastModified });

/** Mount a minimal component so Pinia + VueQuery plugins are active. */
const mountWithPlugins = () => {
  sharedQueryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const pinia = createPinia();
  setActivePinia(pinia);
  const Wrapper = defineComponent({ setup() {}, template: '<div />' });
  mount(Wrapper, { global: { plugins: [pinia, [VueQueryPlugin, { queryClient: sharedQueryClient }]] } });
};

/** Password the last estimate/extract request carried, `undefined` when none. */
const lastEstimatePassword = () => mockEstimate.mock.lastCall?.[0].password;
const lastExtractPassword = () => mockExtract.mock.lastCall?.[0].password;

/** Selects `files`, estimates them all, then extracts them all. */
const importFiles = async ({ store, files }: { store: ReturnType<typeof useStatementParserStore>; files: File[] }) => {
  await store.setFiles({ files });
  await store.estimateCosts();
  await store.extractAll();
};

// ----- tests -----

describe('useStatementParserStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProgress = ref(null);
    mockExecuteError = ref(null);
    mockStart = vi.fn();
    mockEstimate.mockResolvedValue(COST_ESTIMATE);
    mountWithPlugins();
  });

  describe('file selection', () => {
    it('drops the estimate of the previous file when a new file is picked', async () => {
      const store = useStatementParserStore();
      await store.setFiles({ files: [aPdf()] });
      await store.estimateCosts();
      expect(store.fileEntries[0]!.costEstimate).not.toBeNull();

      await store.setFiles({ files: [aPdf('other.pdf')] });

      expect(store.fileEntries[0]!.costEstimate).toBeNull();
    });

    it('drops the extraction result and error of the previous file when a new file is picked', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      await importFiles({ store, files: [aPdf()] });
      expect(store.fileEntries[0]!.extraction).not.toBeNull();

      await store.setFiles({ files: [aPdf('other.pdf')] });

      expect(store.fileEntries[0]!.extraction).toBeNull();
      expect(store.fileEntries[0]!.extractionError).toBeNull();
    });

    it('drops the error and password of the previous file when a new file is picked', async () => {
      const store = useStatementParserStore();
      mockEstimate.mockResolvedValue(PASSWORD_FAILURE);
      await store.setFiles({ files: [aPdf()] });
      await store.estimateCosts();
      store.setDocumentPassword({ id: store.fileEntries[0]!.id, password: 'hunter2' });

      await store.setFiles({ files: [aPdf('other.pdf')] });

      expect(store.fileEntries[0]!.estimateError).toBeNull();
      expect(store.fileEntries[0]!.estimateErrorCode).toBeNull();
      expect(store.fileEntries[0]!.password).toBeNull();

      mockEstimate.mockResolvedValue(COST_ESTIMATE);
      await store.estimateCosts();
      expect(lastEstimatePassword()).toBeUndefined();
    });

    it('keeps paid-for results on files that stay selected', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      const a = aPdf('a.pdf');
      const b = aPdf('b.pdf');
      await importFiles({ store, files: [a, b] });

      await store.setFiles({ files: [b, a] });

      expect(mockEstimate).toHaveBeenCalledTimes(2);
      expect(mockExtract).toHaveBeenCalledTimes(2);
      expect(store.fileEntries.map((entry) => entry.file.name)).toEqual(['b.pdf', 'a.pdf']);
      expect(store.fileEntries.every((entry) => entry.costEstimate && entry.extraction)).toBe(true);
      expect(store.transactionSources).toEqual(['b.pdf', 'a.pdf']);
      expect(store.mergedTransactions).toHaveLength(2);
      expect(store.completedStepKeys.has('upload')).toBe(true);
    });

    it('keeps upload completed when a file is removed after extraction', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      const a = aPdf('a.pdf');
      await importFiles({ store, files: [a, aPdf('b.pdf')] });

      await store.setFiles({ files: [a] });

      expect(store.mergedTransactions).toHaveLength(1);
      expect(store.currentStepKey).toBe('upload');
      expect(store.completedStepKeys.has('upload')).toBe(true);
    });

    it('treats an identical selection as a no-op', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      const files = [aPdf()];
      await importFiles({ store, files });
      store.toggleTransactionExclusion({ transactionIndex: 0 });
      const stepBefore = store.currentStepKey;

      await store.setFiles({ files });

      expect(store.excludedTransactionIndices.has(0)).toBe(true);
      expect(store.currentStepKey).toBe(stepBefore);
    });

    it('clears the password and the error code on reset', async () => {
      const store = useStatementParserStore();
      mockEstimate.mockResolvedValue(PASSWORD_FAILURE);
      await store.setFiles({ files: [aPdf()] });
      await store.estimateCosts();
      store.setDocumentPassword({ id: store.fileEntries[0]!.id, password: 'hunter2' });

      store.reset();

      expect(store.fileEntries).toHaveLength(0);

      mockEstimate.mockResolvedValue(COST_ESTIMATE);
      await store.setFiles({ files: [aPdf()] });
      await store.estimateCosts();
      expect(store.fileEntries[0]!.estimateError).toBeNull();
      expect(store.fileEntries[0]!.estimateErrorCode).toBeNull();
      expect(lastEstimatePassword()).toBeUndefined();
    });
  });

  describe('estimate', () => {
    it('surfaces the text-extraction error code from a failed estimate', async () => {
      const store = useStatementParserStore();
      mockEstimate.mockResolvedValue(PASSWORD_FAILURE);
      await store.setFiles({ files: [aPdf()] });

      await store.estimateCosts();

      expect(store.fileEntries[0]!.estimateErrorCode).toBe('PASSWORD_REQUIRED');
      expect(store.fileEntries[0]!.estimateError).toBe(PASSWORD_FAILURE.suggestion);
      expect(store.fileEntries[0]!.costEstimate).toBeNull();
    });

    it('sends each file only its own password', async () => {
      const store = useStatementParserStore();
      await store.setFiles({ files: [aPdf('a.pdf'), aPdf('b.pdf')] });
      store.setDocumentPassword({ id: store.fileEntries[1]!.id, password: 'hunter2' });

      await store.estimateCosts();

      expect(mockEstimate.mock.calls[0]![0].password).toBeUndefined();
      expect(mockEstimate.mock.calls[1]![0].password).toBe('hunter2');
    });

    it('re-requests a file with its password once one is supplied', async () => {
      const store = useStatementParserStore();
      mockEstimate.mockResolvedValue(PASSWORD_FAILURE);
      await store.setFiles({ files: [aPdf()] });
      await store.estimateCosts();
      expect(store.pendingEstimateEntries).toHaveLength(0);

      store.setDocumentPassword({ id: store.fileEntries[0]!.id, password: 'hunter2' });

      expect(store.pendingEstimateEntries).toHaveLength(1);

      mockEstimate.mockResolvedValue(COST_ESTIMATE);
      await store.estimateCosts();

      expect(lastEstimatePassword()).toBe('hunter2');
      expect(store.fileEntries[0]!.costEstimate).not.toBeNull();
    });

    it('re-requests a password-locked file without a password after clearing estimate failures', async () => {
      const store = useStatementParserStore();
      mockEstimate.mockResolvedValue(PASSWORD_FAILURE);
      await store.setFiles({ files: [aPdf()] });
      await store.estimateCosts();

      store.clearFailures({ phase: 'estimate' });
      await store.estimateCosts();

      expect(mockEstimate).toHaveBeenCalledTimes(2);
      expect(lastEstimatePassword()).toBeUndefined();
    });

    it('totals the batch and reports an unknown cost when any file is unpriced', async () => {
      const store = useStatementParserStore();
      mockEstimate
        .mockResolvedValueOnce(COST_ESTIMATE)
        .mockResolvedValueOnce({ ...COST_ESTIMATE, estimatedCostUsd: null });
      await store.setFiles({ files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      await store.estimateCosts();

      expect(store.costEstimateTotals).toMatchObject({
        fileCount: 2,
        estimatedInputTokens: 2000,
        estimatedOutputTokens: 1000,
        estimatedCostUsd: null,
      });
    });
  });

  describe('extract', () => {
    it('sends the password set by setDocumentPassword on both estimate and extract', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      await store.setFiles({ files: [aPdf()] });
      store.setDocumentPassword({ id: store.fileEntries[0]!.id, password: 'hunter2' });

      await store.estimateCosts();
      await store.extractAll();

      expect(lastEstimatePassword()).toBe('hunter2');
      expect(lastExtractPassword()).toBe('hunter2');
    });

    it('does not re-extract a file that already produced transactions', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      await importFiles({ store, files: [aPdf()] });

      await store.extractAll();

      expect(mockExtract).toHaveBeenCalledTimes(1);
    });

    it('keeps the password when extraction fails so it can be retried', async () => {
      const store = useStatementParserStore();
      mockExtract.mockRejectedValue(new Error('AI is down'));
      await store.setFiles({ files: [aPdf()] });
      store.setDocumentPassword({ id: store.fileEntries[0]!.id, password: 'hunter2' });
      await store.estimateCosts();

      await store.extractAll();
      store.clearFailures({ phase: 'extract' });
      await store.extractAll();

      expect(store.fileEntries[0]!.extractionError).toBe('pages.statementParser.errors.extractFailed');
      expect(mockExtract).toHaveBeenCalledTimes(2);
      expect(lastExtractPassword()).toBe('hunter2');
    });

    it("shows the server's own message for a failed extraction", async () => {
      const store = useStatementParserStore();
      mockExtract.mockRejectedValue(
        new ApiErrorResponseError('Ліміт запитів вичерпано', {
          code: API_ERROR_CODES.tooManyRequests,
          message: 'Ліміт запитів вичерпано',
        }),
      );
      await store.setFiles({ files: [aPdf()] });
      await store.estimateCosts();

      await store.extractAll();

      expect(store.fileEntries[0]!.extractionError).toBe('Ліміт запитів вичерпано');
    });

    it('skips a file whose estimate failed without blocking the others', async () => {
      const store = useStatementParserStore();
      mockEstimate.mockResolvedValueOnce(COST_ESTIMATE).mockResolvedValueOnce(PASSWORD_FAILURE);
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(mockExtract).toHaveBeenCalledTimes(1);
      expect(store.fileEntries[0]!.extraction).not.toBeNull();
      expect(store.fileEntries[1]!.extraction).toBeNull();
      expect(store.fileEntries[1]!.estimateErrorCode).toBe('PASSWORD_REQUIRED');
      expect(store.currentStepKey).toBe('upload');
    });

    it('does not extract a file that was never estimated', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      const a = aPdf('a.pdf');
      await store.setFiles({ files: [a] });
      await store.estimateCosts();

      await store.setFiles({ files: [a, aPdf('b.pdf')] });
      await store.extractAll();

      expect(mockExtract).toHaveBeenCalledTimes(1);
      expect(store.fileEntries[1]!.extraction).toBeNull();
      expect(store.currentStepKey).toBe('upload');
    });

    it('clearing extract failures does not re-admit an estimate-failed file', async () => {
      const store = useStatementParserStore();
      mockEstimate.mockResolvedValue(PASSWORD_FAILURE);
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      await store.setFiles({ files: [aPdf()] });
      await store.estimateCosts();

      store.clearFailures({ phase: 'extract' });
      await store.extractAll();

      expect(mockExtract).not.toHaveBeenCalled();
      expect(store.estimateFailures).toHaveLength(1);
    });

    it('clears the failure once a retry succeeds', async () => {
      const store = useStatementParserStore();
      mockExtract.mockRejectedValueOnce(new Error('AI is down')).mockResolvedValue(EXTRACTION_RESULT);
      await importFiles({ store, files: [aPdf()] });
      expect(store.extractionFailures).toHaveLength(1);

      store.clearFailures({ phase: 'extract' });
      await store.extractAll();

      expect(store.extractionFailures).toHaveLength(0);
      expect(store.extractedEntries).toHaveLength(1);
    });

    it('discards derived state when a retried file re-bases the merged indices', async () => {
      const store = useStatementParserStore();
      mockExtract
        .mockResolvedValueOnce(extractionWith({ count: 1 }))
        .mockRejectedValueOnce(new Error('AI is down'))
        .mockResolvedValue(extractionWith({ count: 2 }));

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf'), aPdf('c.pdf')] });
      expect(store.mergedTransactions).toHaveLength(3);

      store.toggleTransactionExclusion({ transactionIndex: 1 });
      expect(store.excludedTransactionIndices.has(1)).toBe(true);

      store.clearFailures({ phase: 'extract' });
      await store.extractAll();

      expect(store.excludedTransactionIndices.size).toBe(0);
      expect(store.mergedTransactions).toHaveLength(5);
      expect(store.transactionSources).toEqual(['a.pdf', 'b.pdf', 'b.pdf', 'c.pdf', 'c.pdf']);
      expect(store.currentStepKey).toBe('account');
    });

    it('attributes each merged row to its source file', async () => {
      const store = useStatementParserStore();
      mockExtract
        .mockResolvedValueOnce(extractionWith({ count: 1 }))
        .mockResolvedValueOnce(extractionWith({ count: 2 }));

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(store.transactionSources).toEqual(['a.pdf', 'b.pdf', 'b.pdf']);
    });
  });

  describe('advancing after extraction', () => {
    it('advances to account when every file extracted', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(store.currentStepKey).toBe('account');
      expect(store.completedStepKeys.has('upload')).toBe(true);
    });

    it('stays on upload when a file was skipped at estimate, marking the step complete', async () => {
      const store = useStatementParserStore();
      mockEstimate.mockResolvedValueOnce(COST_ESTIMATE).mockResolvedValueOnce(PASSWORD_FAILURE);
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(store.mergedTransactions).toHaveLength(1);
      expect(store.currentStepKey).toBe('upload');
      expect(store.completedStepKeys.has('upload')).toBe(true);
    });

    it('stays on upload with a partial batch, marking the step complete', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValueOnce(EXTRACTION_RESULT).mockRejectedValueOnce(new Error('AI is down'));

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(store.currentStepKey).toBe('upload');
      expect(store.completedStepKeys.has('upload')).toBe(true);
      expect(store.mergedTransactions).toHaveLength(1);
    });

    it('stays on upload without completing it when every file fails', async () => {
      const store = useStatementParserStore();
      mockExtract.mockRejectedValue(new Error('AI is down'));

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(store.currentStepKey).toBe('upload');
      expect(store.completedStepKeys.has('upload')).toBe(false);
    });
  });

  describe('import payload', () => {
    it('sends the merged list with merged-index skips', async () => {
      const store = useStatementParserStore();
      mockExtract
        .mockResolvedValueOnce(extractionWith({ count: 1 }))
        .mockResolvedValueOnce(extractionWith({ count: 2 }));
      mockDetectDuplicates.mockResolvedValue({
        duplicates: [
          {
            transactionIndex: 1,
            extractedTransaction: EXTRACTION_RESULT.transactions[0]!,
            existingTransaction: { id: 'tx-1', date: '2026-01-01', amount: 3.5, note: 'Coffee' },
          },
        ],
      });
      mockLoadTransactions.mockResolvedValue([]);
      mockExecuteImport.mockResolvedValue({} as never);
      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      store.selectAccount({ account: ACCOUNT });
      await store.proceedFromAccountSelection();
      store.toggleTransactionExclusion({ transactionIndex: 2 });
      await store.executeImport();

      expect(mockExecuteImport).toHaveBeenCalledTimes(1);
      const payload = mockExecuteImport.mock.lastCall![0];
      expect(payload.transactions).toEqual(store.mergedTransactions);
      expect(payload.transactions).toHaveLength(3);
      expect(payload.skipIndices).toEqual([1, 2]);
    });
  });

  describe('import job state', () => {
    const SUMMARY = {
      imported: 2,
      merged: 0,
      skipped: 1,
      errors: [],
      newTransactionIds: ['tx-1', 'tx-2'],
      batchId: 'batch-1',
    };

    /** A store with one extracted file and an account picked, ready to import. */
    const readyStore = async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(EXTRACTION_RESULT);
      await importFiles({ store, files: [aPdf()] });
      store.selectAccount({ account: ACCOUNT });
      return store;
    };

    it('reports a failed enqueue as a translated importError, with no job error', async () => {
      const store = await readyStore();
      mockExecuteImport.mockRejectedValue(new Error('network down'));

      await store.executeImport();

      expect(store.importError).toBe('pages.statementParser.errors.importFailed');
      expect(store.isImporting).toBe(false);
      expect(store.importJobError).toBeNull();
    });

    it('is importing while the job runs', async () => {
      const store = await readyStore();
      mockExecuteImport.mockResolvedValue({ jobId: 'job-1' });

      await store.executeImport();
      mockProgress.value = { jobId: 'job-1', status: 'running', processedCount: 1, totalCount: 3 };

      expect(store.isImporting).toBe(true);
      expect(store.importJobError).toBeNull();
    });

    it('exposes the summary once the job completes', async () => {
      const store = await readyStore();

      mockProgress.value = { jobId: 'job-1', status: 'completed', processedCount: 3, totalCount: 3, summary: SUMMARY };

      expect(store.importResult).toEqual(SUMMARY);
      expect(store.isImporting).toBe(false);
    });

    it('surfaces the error of a failed job', async () => {
      const store = await readyStore();

      mockProgress.value = { jobId: 'job-1', status: 'failed', processedCount: 1, totalCount: 3, error: 'worker died' };

      expect(store.importJobError).toBe('worker died');
      expect(store.isImporting).toBe(false);
    });

    it('still reports a failed job that carries no error message', async () => {
      const store = await readyStore();

      mockProgress.value = { jobId: 'job-1', status: 'failed', processedCount: 1, totalCount: 3, error: '' };

      expect(store.importJobError).toBeTruthy();
      expect(store.isImporting).toBe(false);
    });

    it('stops importing when contact with a running job is lost', async () => {
      const store = await readyStore();

      mockProgress.value = { jobId: 'job-1', status: 'running', processedCount: 1, totalCount: 3 };
      mockExecuteError.value = 'Lost contact with the import job';

      expect(store.isImporting).toBe(false);
      expect(store.importJobError).toBe('Lost contact with the import job');
    });

    it('ignores a second import while one is in flight', async () => {
      const store = await readyStore();
      mockExecuteImport.mockResolvedValue({ jobId: 'job-1' });

      await store.executeImport();
      mockProgress.value = { jobId: 'job-1', status: 'queued', processedCount: 0, totalCount: 0 };
      await store.executeImport();

      expect(mockExecuteImport).toHaveBeenCalledTimes(1);
    });

    it('follows the in-flight job when the server answers with a conflict', async () => {
      const store = await readyStore();
      mockExecuteImport.mockRejectedValue(
        new ApiErrorResponseError('Import already running', {
          code: API_ERROR_CODES.conflict,
          details: { jobId: 'job-9' },
        }),
      );

      await store.executeImport();

      expect(mockStart).toHaveBeenCalledWith({
        initialProgress: { jobId: 'job-9', status: 'queued', processedCount: 0, totalCount: 0 },
      });
      expect(store.importError).toBeNull();
    });
  });

  describe('detected currency', () => {
    it('reports the currency when every file agrees', async () => {
      const store = useStatementParserStore();
      mockExtract.mockResolvedValue(extractionWith({ count: 1, metadata: { currencyCode: 'USD' } }));

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(store.detectedCurrency).toBe('USD');
      expect(store.hasCurrencyConflict).toBe(false);
    });

    it('reports a conflict when files disagree', async () => {
      const store = useStatementParserStore();
      mockExtract
        .mockResolvedValueOnce(extractionWith({ count: 1, metadata: { currencyCode: 'USD' } }))
        .mockResolvedValueOnce(extractionWith({ count: 1, metadata: { currencyCode: 'EUR' } }));

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(store.detectedCurrency).toBeUndefined();
      expect(store.hasCurrencyConflict).toBe(true);
    });

    it('ignores a file that detected no currency', async () => {
      const store = useStatementParserStore();
      mockExtract
        .mockResolvedValueOnce(extractionWith({ count: 1 }))
        .mockResolvedValueOnce(extractionWith({ count: 1, metadata: { currencyCode: 'USD' } }));

      await importFiles({ store, files: [aPdf('a.pdf'), aPdf('b.pdf')] });

      expect(store.detectedCurrency).toBe('USD');
      expect(store.hasCurrencyConflict).toBe(false);
    });
  });
});
