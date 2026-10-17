import { NOTIFICATION_PUSH_GROUP, NOTIFICATION_STATUSES } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { type SentryTraceData, captureException, withQueueProcessSpan } from '@js/utils/sentry';
import Notifications from '@models/notifications.model';
import PushSubscriptions from '@models/push-subscriptions.model';
import UserSettings from '@models/user-settings.model';
import { FRONTEND_BASE_URL } from '@root/config';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Transaction } from 'sequelize';

import { buildPushPayload } from './build-push-payload';
import { getWebPushConfig } from './config';
import { isPushGroupEnabled } from './preferences';
import { DELIVER_JOB, FAN_OUT_JOB, deliverJobOptions } from './push-job-options';
import { sendToSubscription } from './send-to-subscription';

interface WebPushJobData extends SentryTraceData {
  notificationId: string;
  /** Set on `deliver` jobs only */
  subscriptionId?: string;
}

const NOTIFICATION_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_LOCALE = 'en';

// One job at a time under test, so jobs that do not retry finish in the order they were queued.
const WORKER_CONCURRENCY = process.env.NODE_ENV === 'test' ? 1 : 10;

const baseConnection = {
  host: process.env.APPLICATION_REDIS_HOST,
  connectTimeout: 20000,
  keepAlive: 10000,
  retryStrategy: (times: number) => Math.min(times * 100, 3000),
};

// The worker blocks on Redis, which BullMQ requires `maxRetriesPerRequest: null` for.
const workerConnection = { ...baseConnection, maxRetriesPerRequest: null };

// The producer must not hang a notification write while Redis is down: with the offline queue off,
// `add` fails fast on a dropped connection instead of piling commands up until it returns.
const producerConnection = { ...baseConnection, maxRetriesPerRequest: null, enableOfflineQueue: false };

// Namespace the queue by Jest worker ID in tests so parallel workers do not share jobs.
export const webPushQueueName =
  process.env.NODE_ENV === 'test' && process.env.JEST_WORKER_ID ? `web-push-${process.env.JEST_WORKER_ID}` : 'web-push';

export const webPushQueue = new Queue<WebPushJobData>(webPushQueueName, {
  connection: producerConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: { age: 3600 }, // Keep failed jobs for 1 hour for debugging
  },
});

webPushQueue.on('error', (err) => {
  // Ignore "Connection is closed" errors during test teardown.
  if (!err.message.includes('Connection is closed')) {
    logger.error({ message: '[Web Push] Queue error', error: err });
  }
});

/** The push service could not take the message right now; BullMQ retries. */
class PushServiceUnavailableError extends Error {}

const isStillDeliverable = ({
  notification,
}: {
  notification: Pick<Notifications, 'status' | 'expiresAt'> | null;
}): boolean =>
  notification !== null &&
  notification.status === NOTIFICATION_STATUSES.unread &&
  (!notification.expiresAt || notification.expiresAt.getTime() > Date.now());

const loadUserSettings = async ({ userId, transaction }: { userId: number; transaction: Transaction | null }) => {
  const row = await UserSettings.findOne({ where: { userId }, attributes: ['settings'], transaction });
  return row?.settings ?? null;
};

/**
 * Decides which devices a notification goes to and queues one `deliver` job per device. It skips
 * a notification that was read, dismissed or has expired since it was created, a group the user
 * turned off, and a user without devices.
 *
 * Every query passes `transaction: null`. The worker shares a process with the HTTP server, and
 * cls-hooked can hand an unpinned query a concurrent request's already-committed transaction.
 */
export const processFanOut = async ({
  notificationId,
  transaction = null,
}: {
  notificationId: string;
  transaction?: Transaction | null;
}): Promise<void> => {
  if (!getWebPushConfig()) return;

  const notification = await Notifications.findByPk(notificationId, { transaction });
  if (!notification || !isStillDeliverable({ notification })) return;

  const settings = await loadUserSettings({ userId: notification.userId, transaction });
  if (!isPushGroupEnabled({ settings, group: NOTIFICATION_PUSH_GROUP[notification.type] })) return;

  const subscriptions = await PushSubscriptions.findAll({
    where: { userId: notification.userId },
    attributes: ['id'],
    transaction,
  });
  if (subscriptions.length === 0) return;

  await webPushQueue.addBulk(
    subscriptions.map(({ id }) => ({
      name: DELIVER_JOB,
      data: { notificationId, subscriptionId: id },
      opts: deliverJobOptions({ notificationId, subscriptionId: id }),
    })),
  );
};

/**
 * Sends a notification to one device. The notification is checked again because the user may
 * have read it while the job waited or backed off. The device is loaded by its id together with
 * the notification's owner: Enable moves a row to another account under the same id, and a
 * browser handed over in the meantime must not receive the previous account's text.
 */
export const processDeliver = async ({
  notificationId,
  subscriptionId,
  isLastAttempt,
  transaction = null,
}: {
  notificationId: string;
  subscriptionId: string;
  isLastAttempt: boolean;
  transaction?: Transaction | null;
}): Promise<void> => {
  if (!getWebPushConfig()) return;

  const notification = await Notifications.findByPk(notificationId, { transaction });
  if (!notification || !isStillDeliverable({ notification })) return;

  const subscription = await PushSubscriptions.findOne({
    where: { id: subscriptionId, userId: notification.userId },
    transaction,
  });
  if (!subscription) return;

  const settings = await loadUserSettings({ userId: notification.userId, transaction });
  const unreadCount = await Notifications.count({
    where: { userId: notification.userId, status: NOTIFICATION_STATUSES.unread },
    transaction,
  });

  const payload = buildPushPayload({
    notification,
    locale: settings?.locale ?? DEFAULT_LOCALE,
    origin: FRONTEND_BASE_URL,
    unreadCount,
  });

  const result = await sendToSubscription({
    subscription,
    payload,
    ttl: NOTIFICATION_TTL_SECONDS,
    urgency: 'normal',
    // 32 hex characters: valid for the Topic header, and the same for every retry of this message.
    topic: notificationId.replaceAll('-', ''),
    recordTransientFailure: isLastAttempt,
  });

  if (result === 'retry') throw new PushServiceUnavailableError('The push service did not accept the message');
  if (result === 'rejected') throw new UnrecoverableError('The push service rejected the subscription');
};

/**
 * Worker for the `fan-out` and `deliver` jobs. Exported for cleanup in test teardown.
 */
export const webPushWorker = new Worker<WebPushJobData>(
  webPushQueueName,
  async (job: Job<WebPushJobData>) =>
    withQueueProcessSpan({
      queueName: webPushQueueName,
      job,
      fn: async () => {
        const { notificationId, subscriptionId } = job.data;

        if (job.name === FAN_OUT_JOB) {
          await processFanOut({ notificationId, transaction: null });
        } else if (job.name === DELIVER_JOB && subscriptionId) {
          await processDeliver({
            notificationId,
            subscriptionId,
            isLastAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
            transaction: null,
          });
        }
      },
    }),
  { connection: workerConnection, concurrency: WORKER_CONCURRENCY },
);

webPushWorker.on('failed', (job, err) => {
  // A refusal or a transient push service answer is an expected outcome, already logged by the sender.
  if (err instanceof PushServiceUnavailableError || err instanceof UnrecoverableError) {
    logger.warn(`[Web Push] Job ${job?.id} failed: ${err.message}`);
    return;
  }

  logger.error({ message: `[Web Push] Job ${job?.id} failed`, error: err });
  captureException({ error: err, context: { jobId: job?.id, jobName: job?.name } });
});

webPushWorker.on('error', (err) => {
  // Ignore "Connection is closed" errors during test teardown.
  if (!err.message.includes('Connection is closed')) {
    logger.error({ message: '[Web Push] Worker error', error: err });
  }
});
