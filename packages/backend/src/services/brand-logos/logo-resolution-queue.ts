import { logger } from '@js/utils/logger';
import { runAfterCommit } from '@services/common/run-after-commit';
import { Job, Queue, Worker } from 'bullmq';

import { LogoEntity, resolveBrandLogo } from './resolve-brand-logo.service';

interface LogoResolutionJobData {
  entity: LogoEntity;
  id: string;
}

// Redis connection configuration for BullMQ. Mirrors the resilient settings of
// the main redisClient / ai-categorization queue to prevent "Connection is
// closed" errors in CI. BullMQ requires `maxRetriesPerRequest: null`.
const connection = {
  host: process.env.APPLICATION_REDIS_HOST,
  maxRetriesPerRequest: null,
  connectTimeout: 20000, // 20s connection timeout for slower CI environments
  keepAlive: 10000, // Send TCP keepalive to prevent idle disconnection
  retryStrategy: (times: number) => Math.min(times * 100, 3000), // Exponential backoff, max 3s
};

// Namespace queue by Jest worker ID in test environment so parallel workers
// don't share a queue.
const queueName =
  process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID
    ? `brand-logo-resolution-${process.env.JEST_WORKER_ID}`
    : 'brand-logo-resolution';

/**
 * Queue for per-entity brand-logo resolution jobs (payees and subscriptions).
 */
export const logoResolutionQueue = new Queue<LogoResolutionJobData>(queueName, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000, // 1min, 2min, 4min
    },
    removeOnComplete: true,
    removeOnFail: {
      age: 3600, // Keep failed jobs for 1 hour for debugging
    },
  },
});

// Handle Queue error events to prevent unhandled exceptions in CI.
logoResolutionQueue.on('error', (err) => {
  // Ignore "Connection is closed" errors during test teardown.
  if (!err.message.includes('Connection is closed')) {
    logger.error({ message: '[Brand Logo Queue] Queue error', error: err });
  }
});

/**
 * Worker that resolves one entity's logo per job. Concurrency plus a rate
 * limiter bound the logo.dev request rate across all in-flight jobs.
 * Exported for proper cleanup in test teardown.
 */
export const logoResolutionWorker = new Worker<LogoResolutionJobData>(
  queueName,
  async (job: Job<LogoResolutionJobData>) => {
    const { entity, id } = job.data;
    // `transaction: null` bypasses Sequelize's cls-hooked ambient transaction
    // injection – see resolveBrandLogo JSDoc for the full rationale.
    await resolveBrandLogo({ entity, id, transaction: null });
  },
  {
    connection,
    concurrency: 5,
    // Bound logo.dev QPS regardless of concurrency / pending backlog.
    limiter: {
      max: 10,
      duration: 1000,
    },
  },
);

logoResolutionWorker.on('failed', (job, err) => {
  logger.error({ message: `[Brand Logo Worker] Job ${job?.id} failed`, error: err });
});

logoResolutionWorker.on('error', (err) => {
  // Ignore "Connection is closed" errors during test teardown.
  if (!err.message.includes('Connection is closed')) {
    logger.error({ message: '[Brand Logo Worker] Worker error', error: err });
  }
});

/**
 * Enqueue logo resolution for a single entity. The `<entity>-logo-<id>` jobId
 * dedups re-enqueues of the same row (e.g. lazy-on-read backfill firing on
 * every list request) down to one in-flight job. BullMQ forbids `:` in a custom
 * job id, so the separator is `-` (entity ids are uuids – no colons).
 *
 * Safe to call when Redis / the queue is unavailable: a failed enqueue is
 * logged and swallowed so it can never break a write path or a read path.
 */
export async function enqueueLogoResolution({ entity, id }: { entity: LogoEntity; id: string }): Promise<void> {
  try {
    await logoResolutionQueue.add('resolve-logo', { entity, id }, { jobId: `${entity}-logo-${id}` });
  } catch (error) {
    logger.warn(`[Brand Logo Queue] Failed to enqueue logo resolution for ${entity} ${id}: ${String(error)}`);
  }
}

/**
 * Enqueue logo resolution only after the surrounding DB transaction commits.
 *
 * A row created inside a transaction isn't visible to the worker (a separate
 * connection) until commit, and the row vanishes entirely on rollback – so
 * enqueuing before commit risks the worker reading a not-yet-visible or
 * rolled-back row. Without an ambient transaction it enqueues directly.
 */
export function enqueueLogoResolutionAfterCommit({ entity, id }: { entity: LogoEntity; id: string }): void {
  void runAfterCommit({ fn: () => enqueueLogoResolution({ entity, id }) });
}
