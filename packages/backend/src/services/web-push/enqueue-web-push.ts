import { logger } from '@js/utils/logger';
import { withQueuePublishSpan } from '@js/utils/sentry';
import { namespace } from '@models/connection';
import type { Transaction } from 'sequelize';

import { getWebPushConfig } from './config';
import { FAN_OUT_JOB, fanOutJobOptions } from './push-job-options';
import { webPushQueue, webPushQueueName } from './push-queue';

const ENQUEUE_TIMEOUT_MS = 2000;
const BULK_CHUNK_SIZE = 500;

const withTimeout = async <T>({ promise, ms }: { promise: Promise<T>; ms: number }): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  // A call that loses the race may still reject later; without a handler that would crash the process.
  promise.catch(() => {});

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

const chunk = <T>({ items, size }: { items: T[]; size: number }): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
};

const addFanOutJobs = async ({ notificationIds }: { notificationIds: string[] }): Promise<void> => {
  await withQueuePublishSpan({
    queueName: webPushQueueName,
    messageId: notificationIds[0]!,
    payloadSize: notificationIds.length,
    fn: async (traceData) => {
      if (notificationIds.length === 1) {
        const [notificationId] = notificationIds as [string];
        await webPushQueue.add(FAN_OUT_JOB, { notificationId, ...traceData }, fanOutJobOptions({ notificationId }));
        return;
      }

      await webPushQueue.addBulk(
        notificationIds.map((notificationId) => ({
          name: FAN_OUT_JOB,
          data: { notificationId, ...traceData },
          opts: fanOutJobOptions({ notificationId }),
        })),
      );
    },
  });
};

/**
 * Queues the fan-out jobs. The bell entry is the source of truth, so a failed or hung enqueue
 * only costs the push: it is logged (without the payload) and swallowed.
 */
const enqueueFanOut = async ({ notificationIds }: { notificationIds: string[] }): Promise<void> => {
  for (const ids of chunk({ items: notificationIds, size: BULK_CHUNK_SIZE })) {
    try {
      await withTimeout({ promise: addFanOutJobs({ notificationIds: ids }), ms: ENQUEUE_TIMEOUT_MS });
    } catch (error) {
      logger.warn(`[Web Push] enqueue failed or timed out: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }
};

/**
 * Queues a Web Push fan-out for freshly created notifications once the surrounding transaction
 * commits. A row created inside a transaction is invisible to the worker (another connection)
 * until commit and gone on rollback, so the job waits for the commit.
 *
 * Fire-and-forget on purpose: Sequelize awaits `afterCommit` callbacks inside `commit()`, and
 * with Redis down a BullMQ `add` neither resolves nor rejects, so returning the enqueue promise
 * would hang every write that creates a notification until Redis returns.
 *
 * A no-op when Web Push is not configured.
 */
export function enqueueWebPushAfterCommit({ notificationIds }: { notificationIds: string[] }): void {
  if (notificationIds.length === 0 || !getWebPushConfig()) return;

  // `finished` ('commit' | 'rollback') is not on the public Transaction type; `withTransaction`
  // checks it the same way to detect a stale CLS transaction.
  const transaction = namespace.get('transaction') as (Transaction & { finished?: string }) | undefined;

  if (transaction && !transaction.finished) {
    transaction.afterCommit(() => {
      void enqueueFanOut({ notificationIds });
    });
  } else {
    void enqueueFanOut({ notificationIds });
  }
}
