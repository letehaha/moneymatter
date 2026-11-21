import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { LockedError, ValidationError } from '@js/errors';

// Block the real queue module, whose import chain builds BullMQ queues at module scope.
jest.mock('@services/import-export/delete-batch-queue', () => ({ queueImportBatchDelete: jest.fn() }));
jest.mock('@services/import-export/delete-batch.service', () => {
  class ImportBatchTooLargeError extends Error {
    readonly rowCount: number;

    constructor({ rowCount }: { rowCount: number }) {
      super(`Import batch has ${rowCount} rows, above the synchronous cap`);
      this.rowCount = rowCount;
    }
  }
  return { deleteImportBatch: jest.fn(), ImportBatchTooLargeError };
});

import { queueImportBatchDelete } from '@services/import-export/delete-batch-queue';
import { ImportBatchTooLargeError, deleteImportBatch } from '@services/import-export/delete-batch.service';

import { deleteOrQueueImportBatch } from './delete-or-queue-batch.service';

const deleteService = jest.mocked(deleteImportBatch);
const queueService = jest.mocked(queueImportBatchDelete);

const BATCH_ID = '11111111-1111-4111-8111-111111111111';
const request = { userId: 42, batchId: BATCH_ID, deleteLinkedTransfers: false };

beforeEach(() => {
  jest.resetAllMocks();
});

describe('deleteOrQueueImportBatch', () => {
  it('returns the inline result of a batch under the cap and queues nothing', async () => {
    deleteService.mockResolvedValue({ deletedCount: 2, deletedIds: ['a', 'b'] });

    await expect(deleteOrQueueImportBatch(request)).resolves.toEqual({ deletedCount: 2, deletedIds: ['a', 'b'] });

    expect(deleteService).toHaveBeenCalledWith(request);
    expect(queueService).not.toHaveBeenCalled();
  });

  it('queues a batch above the cap with the same request and returns the job id', async () => {
    deleteService.mockRejectedValue(new ImportBatchTooLargeError({ rowCount: 1001 }));
    queueService.mockResolvedValue('import-batch-delete-42-job');

    const result = await deleteOrQueueImportBatch({ ...request, deleteLinkedTransfers: true });

    expect(result).toEqual({ jobId: 'import-batch-delete-42-job' });
    expect(queueService).toHaveBeenCalledWith({ userId: 42, batchId: BATCH_ID, deleteLinkedTransfers: true });
  });

  it('passes every other refusal through without queueing', async () => {
    deleteService.mockRejectedValue(new ValidationError({ message: 'bank-linked' }));
    await expect(deleteOrQueueImportBatch(request)).rejects.toThrow('bank-linked');

    deleteService.mockRejectedValue(new LockedError({ message: 'still running' }));
    await expect(deleteOrQueueImportBatch(request)).rejects.toThrow('still running');

    expect(queueService).not.toHaveBeenCalled();
  });

  it('passes a refused enqueue through, so a second delete in flight stays a lock error', async () => {
    deleteService.mockRejectedValue(new ImportBatchTooLargeError({ rowCount: 5000 }));
    queueService.mockRejectedValue(new LockedError({ message: 'delete in progress' }));

    await expect(deleteOrQueueImportBatch(request)).rejects.toThrow('delete in progress');
  });
});
