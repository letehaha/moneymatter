import type { ImportSource } from './core';

/**
 * One import batch in GET /import/batches-history. All transactions of a batch share a
 * single `importDetails.batchId`, so the id doubles as the filter for drilling into
 * GET /transactions?batchId=.
 */
export interface ImportBatchSummary {
  batchId: string;
  source: ImportSource;
  /** ISO timestamp shared by every transaction the batch created. */
  importedAt: string;
  transactionCount: number;
  /** Distinct account ids touched by the batch. */
  accountIds: string[];
  /** Accounts the import created; undo deletes each one that has no transactions left. */
  createdAccountCount: number;
}

/**
 * Response of GET /import/batches-history. `totalCount` is only filled on the first
 * page (`offset === 0`) and is `null` on every later one, same convention as
 * `AiCategorizationHistoryResponse`.
 */
export interface ImportBatchesHistoryResponse {
  items: ImportBatchSummary[];
  totalCount: number | null;
}

/** Synchronous response of DELETE /import/batch/:batchId. */
export interface DeleteImportBatchResponse {
  deletedCount: number;
  deletedIds: string[];
}

/** 202 response of DELETE /import/batch/:batchId when the batch is too large to
 *  delete synchronously: the delete runs as a background job that holds the
 *  app-wide write-lock until it finishes. */
export interface DeleteImportBatchQueuedResponse {
  jobId: string;
}

export type DeleteImportBatchResult = DeleteImportBatchResponse | DeleteImportBatchQueuedResponse;

/** Response of GET /import/batch-delete/status. Never 404s: "no job" is `idle`. */
export type ImportBatchDeleteActiveStatus =
  | { state: 'idle' }
  | { state: 'queued'; jobId: string }
  | { state: 'running'; jobId: string }
  | { state: 'completed'; jobId: string; deletedCount: number }
  | { state: 'failed'; jobId: string; error: string };

/** SSE payload of the batch-delete worker, in the shared import-queue shape. */
interface ImportBatchDeleteProgressBase {
  jobId: string;
  processedCount: number;
  totalCount: number;
}

export type ImportBatchDeleteProgress =
  | (ImportBatchDeleteProgressBase & { status: 'queued' | 'running' })
  | (ImportBatchDeleteProgressBase & { status: 'completed'; summary: { deletedCount: number } })
  | (ImportBatchDeleteProgressBase & { status: 'failed'; error: string });
