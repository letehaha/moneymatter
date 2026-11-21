import type { DeleteImportBatchResult } from '@bt/shared/types';

import { queueImportBatchDelete } from './delete-batch-queue';
import { ImportBatchTooLargeError, deleteImportBatch } from './delete-batch.service';

/**
 * Undoes an import batch inline when it is small enough, and hands it to the background worker
 * when it is above the synchronous cap. Returns `{ deletedCount, deletedIds }` for the first and
 * `{ jobId }` for the second; progress is read with `getUserActiveImportBatchDeleteStatus`.
 * Every other refusal (bank-linked account, running import, a delete already in flight) passes through.
 */
export async function deleteOrQueueImportBatch({
  userId,
  batchId,
  deleteLinkedTransfers,
}: {
  userId: number;
  batchId: string;
  deleteLinkedTransfers: boolean;
}): Promise<DeleteImportBatchResult> {
  const request = { userId, batchId, deleteLinkedTransfers };

  try {
    return await deleteImportBatch(request);
  } catch (error) {
    if (!(error instanceof ImportBatchTooLargeError)) throw error;
    return { jobId: await queueImportBatchDelete(request) };
  }
}
