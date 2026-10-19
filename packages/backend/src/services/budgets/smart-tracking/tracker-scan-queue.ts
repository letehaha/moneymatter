import {
  type RecordId,
  SSE_EVENT_TYPES,
  type TrackerScanStatus,
  type TrackerScanStatusPayload,
} from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { SentryTraceData, withQueueProcessSpan, withQueuePublishSpan } from '@js/utils/sentry';
import Budgets from '@models/budget.model';
import { sseManager } from '@services/common/sse';
import { Job, Queue, Worker } from 'bullmq';

import { runTrackerScan } from './run-tracker-scan';

interface TrackerScanJobData extends SentryTraceData {
  budgetId: string;
}

const connection = {
  host: process.env.APPLICATION_REDIS_HOST,
  maxRetriesPerRequest: null,
  connectTimeout: 20000,
  keepAlive: 10000,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
};

const queueName =
  process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID
    ? `tracker-smart-scan-worker-${process.env.JEST_WORKER_ID}`
    : 'tracker-smart-scan';

const buildJobId = ({ budgetId }: { budgetId: string }) => `tracker-scan-${budgetId}`;

export const trackerScanQueue = new Queue<TrackerScanJobData>(queueName, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: true,
    removeOnFail: { age: 3600 },
  },
});

trackerScanQueue.on('error', (err) => {
  if (!err.message.includes('Connection is closed')) {
    logger.error({ message: '[Tracker Scan Queue] Queue error', error: err });
  }
});

const notifyOwner = async ({
  payload,
}: {
  payload: Omit<TrackerScanStatusPayload, 'budgetId'> & { budgetId: string };
}) => {
  const budget = await Budgets.findByPk(payload.budgetId, { attributes: ['userId'] });
  if (!budget) return;
  sseManager.sendToUser({
    userId: budget.userId,
    event: SSE_EVENT_TYPES.TRACKER_SCAN_STATUS,
    data: { ...payload, budgetId: payload.budgetId as RecordId },
  });
};

export const trackerScanWorker = new Worker<TrackerScanJobData>(
  queueName,
  async (job: Job<TrackerScanJobData>) =>
    withQueueProcessSpan({
      queueName,
      job,
      fn: async () => {
        const { budgetId } = job.data;
        await notifyOwner({ payload: { budgetId, status: 'running' } });
        return (await runTrackerScan({ budgetId })) ?? { linkedCount: 0, suggestedCount: 0 };
      },
    }),
  { connection, concurrency: 3 },
);

trackerScanWorker.on('completed', async (job, result) => {
  await notifyOwner({ payload: { budgetId: job.data.budgetId, status: 'done', ...result } });
});

trackerScanWorker.on('failed', async (job, err) => {
  if (!job) {
    logger.error({ message: '[Tracker Scan Worker] Job failed', error: err });
    return;
  }
  // BullMQ fires `failed` per attempt; only the last one ends the run.
  if (job.attemptsMade < (job.opts.attempts ?? 1)) {
    logger.info(`[Tracker Scan Worker] Job ${job.id} attempt ${job.attemptsMade} failed: ${err.message}`);
    return;
  }

  logger.error({ message: `[Tracker Scan Worker] Job ${job.id} failed`, error: err });
  await notifyOwner({ payload: { budgetId: job.data.budgetId, status: 'failed' } });
});

trackerScanWorker.on('error', (err) => {
  if (!err.message.includes('Connection is closed')) {
    logger.error({ message: '[Tracker Scan Worker] Worker error', error: err });
  }
});

/** One job per tracker: enqueueing while one is waiting or running is a no-op. Best-effort, never throws. */
export const enqueueTrackerScan = async ({ budgetId }: { budgetId: string }): Promise<void> => {
  try {
    const jobId = buildJobId({ budgetId });

    // A failed job is kept for an hour and would swallow every enqueue under its id until then.
    const existing = await trackerScanQueue.getJob(jobId);
    if (existing && (await existing.isFailed())) await existing.remove();

    await withQueuePublishSpan({
      queueName,
      messageId: jobId,
      payloadSize: budgetId.length,
      fn: async (traceData) => {
        await trackerScanQueue.add(jobId, { budgetId, ...traceData }, { jobId });
      },
    });

    await notifyOwner({ payload: { budgetId, status: 'queued' } });
  } catch (error) {
    logger.warn(`[Tracker Scan Queue] Failed to enqueue scan for ${budgetId}: ${String(error)}`);
  }
};

export const getTrackerScanState = async ({
  budgetId,
}: {
  budgetId: string;
}): Promise<{ status: TrackerScanStatus; startedAt: Date | null }> => {
  const job = await trackerScanQueue.getJob(buildJobId({ budgetId }));
  if (!job) return { status: 'idle', startedAt: null };

  const state = await job.getState();
  if (state === 'active') return { status: 'running', startedAt: job.processedOn ? new Date(job.processedOn) : null };
  if (state === 'completed' || state === 'failed' || state === 'unknown') return { status: 'idle', startedAt: null };
  return { status: 'queued', startedAt: null };
};
