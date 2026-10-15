import { api } from '@/api/_api';
import type {
  AiMapImportCategoriesResponse,
  ColumnMappingConfig,
  CsvImportProgress,
  DeleteImportBatchResult,
  DetectDuplicatesRequest,
  DetectDuplicatesResponse,
  ExecuteImportRequest,
  ExecuteImportResponse,
  ExtractUniqueValuesResponse,
  ImportBatchDeleteActiveStatus,
  ImportBatchesHistoryResponse,
  StatementCostEstimate,
  StatementCostEstimateFailure,
  StatementExecuteImportQueuedResponse,
  StatementExecuteImportRequest,
  StatementExtractionResult,
  StatementExtractRequest,
  StatementImportProgress,
} from '@bt/shared/types';

interface ParseCsvRequest {
  fileContent: string;
  delimiter?: string;
}

interface ParseCsvResponse {
  headers: string[];
  preview: Record<string, string>[];
  detectedDelimiter: string;
  totalRows: number;
}

export const parseCsv = async (payload: ParseCsvRequest): Promise<ParseCsvResponse> => {
  const result = await api.post('/import/csv/parse', payload);
  return result;
};

interface ExtractUniqueValuesRequest {
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
}

export const extractUniqueValues = async (
  payload: ExtractUniqueValuesRequest,
): Promise<ExtractUniqueValuesResponse> => {
  const result = await api.post('/import/csv/extract-unique-values', payload);
  return result;
};

export const aiMapImportCategories = async (payload: {
  sourceCategories: string[];
}): Promise<AiMapImportCategoriesResponse> => {
  const result = await api.post('/import/ai-map-categories', payload);
  return result;
};

export const detectDuplicates = async (payload: DetectDuplicatesRequest): Promise<DetectDuplicatesResponse> => {
  const result = await api.post('/import/csv/detect-duplicates', payload);
  return result;
};

export const executeImport = async (payload: ExecuteImportRequest): Promise<ExecuteImportResponse> => {
  const result = await api.post('/import/csv/execute', payload);
  return result;
};

export const getCsvImportStatus = async ({ jobId }: { jobId: string }): Promise<CsvImportProgress> => {
  return api.get(`/import/csv/execute/status/${jobId}`);
};

// Import Batches History API

export const getBatchesHistory = async (params: {
  limit?: number;
  offset?: number;
}): Promise<ImportBatchesHistoryResponse> => {
  return api.get('/import/batches-history', params);
};

export const deleteImportBatch = async ({
  batchId,
  deleteLinkedTransfers,
}: {
  batchId: string;
  deleteLinkedTransfers?: boolean;
}): Promise<DeleteImportBatchResult> => {
  return api.delete(`/import/batch/${batchId}`, { data: { deleteLinkedTransfers } });
};

/**
 * User-scoped status of the background batch delete (no job id). Polled to drive
 * the blocking overlay. Never 404s — returns `idle` when nothing runs.
 */
export const getActiveImportBatchDeleteStatus = async (): Promise<ImportBatchDeleteActiveStatus> => {
  return api.get('/import/batch-delete/status');
};

// Statement Parser API (supports PDF, CSV, TXT)

export const estimateStatementCost = async (
  payload: StatementExtractRequest,
): Promise<StatementCostEstimate | StatementCostEstimateFailure> => {
  const result = await api.post('/import/text-source/estimate-cost', payload);
  return result;
};

export const extractStatementTransactions = async (
  payload: StatementExtractRequest,
): Promise<StatementExtractionResult> => {
  const result = await api.post('/import/text-source/extract', payload);
  return result;
};

// Statement Parser - Duplicate Detection

interface StatementDetectDuplicatesRequest {
  accountId: string;
  transactions: StatementExtractionResult['transactions'];
}

export interface StatementDetectDuplicatesResponse {
  duplicates: Array<{
    transactionIndex: number;
    extractedTransaction: StatementExtractionResult['transactions'][number];
    existingTransaction: {
      id: string;
      date: string;
      amount: number;
      note: string;
    };
  }>;
}

export const detectStatementDuplicates = async (
  payload: StatementDetectDuplicatesRequest,
): Promise<StatementDetectDuplicatesResponse> => {
  return api.post('/import/text-source/detect-duplicates', payload);
};

// Statement Parser - Execute Import

export const executeStatementImport = async (
  payload: StatementExecuteImportRequest,
): Promise<StatementExecuteImportQueuedResponse> => {
  return api.post('/import/text-source/execute', payload);
};

export const getStatementImportStatus = async ({ jobId }: { jobId: string }): Promise<StatementImportProgress> => {
  return api.get(`/import/text-source/execute/status/${jobId}`);
};
