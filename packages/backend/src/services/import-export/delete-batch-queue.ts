import {
  API_ERROR_CODES,
  type ImportBatchDeleteActiveStatus,
  type ImportBatchDeleteProgress,
  SSE_EVENT_TYPES,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { LockedError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { SentryTraceData } from '@js/utils/sentry';
import { redisClient } from '@root/redis-client';
import {
  acquireBaseCurrencyLock,
  extendBaseCurrencyLockTtlIfOwned,
  releaseBaseCurrencyLockIfOwned,
} from '@services/currencies/base-currency-lock';
import { randomUUID } from 'node:crypto';

import { createImportJobQueue } from './core/queue/create-import-job-queue';
import { deleteImportBatch } from './delete-batch.service';

interface ImportBatchDeleteJobData extends SentryTraceData {
  userId: number;
  batchId: string;
  deleteLinkedTransfers: boolean;
}

// The row-by-row undo of a MAX_CSV_ROWS batch can outlive the lock's own TTL; the
// heartbeat keeps the lock from lapsing mid-run.
const LOCK_HEARTBEAT_INTERVAL_MS = 10 * 60 * 1000;

const logLockError = ({ message, err }: { message: string; err: unknown }) =>
  logger.error({ message, error: err instanceof Error ? err : new Error(String(err)) });

const {
  queue: importBatchDeleteQueue,
  worker: importBatchDeleteWorker,
  enqueue,
  getImportProgress,
} = createImportJobQueue<ImportBatchDeleteJobData, { deletedCount: number }, ImportBatchDeleteProgress>({
  baseName: 'import-batch-delete',
  sseEventType: SSE_EVENT_TYPES.IMPORT_BATCH_DELETE_PROGRESS,
  logLabel: 'Import Batch Delete',
  interruptedMessageKey: 'importExport.batchDeleteInterruptedByServerUpdate',
  processJob: async ({ job }) => {
    const { userId, batchId, deleteLinkedTransfers } = job.data;
    const jobId = job.id!;

    // Hold the base-currency write-lock for the whole delete: every mutating route
    // answers 423 and the frontend raises its app-blocking overlay, so nothing can
    // edit rows the delete is about to remove.
    const acquired = await acquireBaseCurrencyLock({ userId, jobId });
    if (!acquired) {
      throw new Error(t({ key: 'currencies.baseCurrencyChangeInProgress' }));
    }

    const heartbeat = setInterval(() => {
      extendBaseCurrencyLockTtlIfOwned({ userId, jobId }).catch((err) =>
        logLockError({ message: `[Import Batch Delete Worker] Lock TTL heartbeat failed for job ${jobId}`, err }),
      );
    }, LOCK_HEARTBEAT_INTERVAL_MS);

    try {
      const { deletedCount } = await deleteImportBatch({ userId, batchId, deleteLinkedTransfers, maxRows: Infinity });
      return { deletedCount };
    } finally {
      clearInterval(heartbeat);
      // A crashed worker skips this; the status endpoint reconciles the orphan.
      await releaseBaseCurrencyLockIfOwned({ userId, jobId }).catch((err) =>
        logLockError({ message: `[Import Batch Delete Worker] Lock release failed for job ${jobId}`, err }),
      );
    }
  },
});

export { importBatchDeleteQueue, importBatchDeleteWorker };

/** Per-user pointer to the latest delete job, so the user-scoped status endpoint
 *  can find an in-flight delete after a reload or from another tab. */
const buildLastJobPointerKey = ({ userId }: { userId: number }): string => `import-batch-delete-last-job-${userId}`;

export async function queueImportBatchDelete({
  userId,
  batchId,
  deleteLinkedTransfers,
}: {
  userId: number;
  batchId: string;
  deleteLinkedTransfers: boolean;
}): Promise<string> {
  // The worker's lock and the route guard cover the running window; this closes the
  // enqueue→pickup gap where neither is in effect yet.
  // ponytail: check-then-set, not atomic. Two DELETEs within the same few ms could
  // both enqueue; the loser fails on lock acquisition. Use SET NX on the pointer if
  // that ever shows up.
  const current = await getUserActiveImportBatchDeleteStatus({ userId });
  if (current.state === 'queued' || current.state === 'running') {
    throw new LockedError({
      code: API_ERROR_CODES.locked,
      message: t({ key: 'importExport.batchDeleteInProgress' }),
    });
  }

  const jobId = `import-batch-delete-${userId}-${randomUUID()}`;
  await redisClient.set(buildLastJobPointerKey({ userId }), jobId, 'EX', 24 * 3600);
  await enqueue({ userId, jobId, data: { userId, batchId, deleteLinkedTransfers } });
  return jobId;
}

export async function getUserActiveImportBatchDeleteStatus({
  userId,
}: {
  userId: number;
}): Promise<ImportBatchDeleteActiveStatus> {
  const jobId = await redisClient.get(buildLastJobPointerKey({ userId }));
  if (!jobId) return { state: 'idle' };

  const progress = await getImportProgress({ userId, jobId });
  const status = progress?.status ?? 'missing';

  // Every terminal or vanished job must leave the lock free: a worker killed mid-delete
  // never reaches its `finally`, and the lock would otherwise 423 every write for its
  // full TTL. Compare-and-delete, so a newer job's lock is never touched.
  if (status !== 'queued' && status !== 'running') {
    await releaseBaseCurrencyLockIfOwned({ userId, jobId });
  }

  switch (progress?.status) {
    case undefined:
      return { state: 'idle' };
    case 'queued':
      return { state: 'queued', jobId };
    case 'running':
      return { state: 'running', jobId };
    case 'completed':
      return { state: 'completed', jobId, deletedCount: progress.summary.deletedCount };
    case 'failed':
      return { state: 'failed', jobId, error: progress.error };
  }
}
