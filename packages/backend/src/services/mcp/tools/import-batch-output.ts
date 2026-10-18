import type { ImportBatchDeleteActiveStatus, ImportBatchSummary } from '@bt/shared/types';

/** One import batch, fields copied by name. */
export function presentImportBatch({ batch }: { batch: ImportBatchSummary }) {
  return {
    batchId: batch.batchId,
    source: batch.source,
    importedAt: batch.importedAt,
    transactionCount: batch.transactionCount,
    accountIds: batch.accountIds,
    createdAccountCount: batch.createdAccountCount,
  };
}

/** The state of the caller's latest batch delete job, fields copied by name. */
export function presentImportBatchDeleteStatus({ status }: { status: ImportBatchDeleteActiveStatus }) {
  switch (status.state) {
    case 'idle':
      return { state: status.state };
    case 'queued':
    case 'running':
      return { state: status.state, jobId: status.jobId };
    case 'completed':
      return { state: status.state, jobId: status.jobId, deletedCount: status.deletedCount };
    case 'failed':
      return { state: status.state, jobId: status.jobId, error: status.error };
  }
}
