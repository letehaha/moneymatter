import type { WebPushMessage } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import PushSubscriptions from '@models/push-subscriptions.model';
import { literal } from 'sequelize';
import { sendNotification } from 'web-push';

import { type SendResultKind, classifySendResult } from './classify-send-result';
import { getWebPushConfig } from './config';
import { isPushEndpointAllowed } from './endpoint-allowlist';

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

/** Consecutive `rejected` results after which a subscription is deleted. */
export const MAX_CONSECUTIVE_REJECTIONS = 10;

const REQUEST_TIMEOUT_MS = 10_000;

// Instance-side refusals (a bad key, clock skew) repeat for every send, so each (host, status)
// is logged and reported once per process.
const reportedInstanceFailures = new Set<string>();

type SendableSubscription = Pick<PushSubscriptions, 'id' | 'endpoint' | 'p256dh' | 'auth' | 'vapidKeyId'>;

const readStatusCode = ({ error }: { error: unknown }): number | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;
  const { statusCode } = error as { statusCode?: unknown };
  return typeof statusCode === 'number' ? statusCode : undefined;
};

const hostOf = ({ endpoint }: { endpoint: string }): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-endpoint';
  }
};

// Every write passes `transaction: null`: the sender runs on the worker path, where cls-hooked can
// hand a query a concurrent request's already-committed transaction.
const recordFailure = async ({
  id,
  statusCode,
  countRejection,
}: {
  id: string;
  statusCode: number | null;
  countRejection: boolean;
}): Promise<void> => {
  const now = new Date();

  if (!countRejection) {
    await PushSubscriptions.update(
      { lastFailureAt: now, lastFailureStatus: statusCode },
      { where: { id }, transaction: null },
    );
    return;
  }

  const [, rows] = await PushSubscriptions.update(
    { failureCount: literal('"failureCount" + 1'), lastFailureAt: now, lastFailureStatus: statusCode },
    { where: { id }, returning: true, transaction: null },
  );

  if (rows[0] && rows[0].failureCount >= MAX_CONSECUTIVE_REJECTIONS) {
    await PushSubscriptions.destroy({ where: { id }, transaction: null });
    logger.info(`[Web Push] Removed subscription ${id} after ${MAX_CONSECUTIVE_REJECTIONS} consecutive rejections`);
  }
};

const reportInstanceFailure = ({ host, statusCode }: { host: string; statusCode: number | undefined }): void => {
  const key = `${host}:${statusCode}`;
  if (reportedInstanceFailures.has(key)) return;
  reportedInstanceFailures.add(key);

  const message = `[Web Push] ${host} refused this instance's push request with status ${statusCode}. Check the VAPID keys, the server clock and the payload size.`;
  logger.warn(message);
  captureException({ error: new Error(message), context: { host, statusCode } });
};

/**
 * Sends one Web Push message to one device and applies the outcome to its row:
 * - a subscription made under another VAPID key is deleted without a request (`gone`);
 * - an endpoint the allowlist now refuses is `rejected` without a request;
 * - 201/202 stamps `lastSuccessAt` and resets `failureCount` (`ok`);
 * - 404/410 deletes the row (`gone`);
 * - 400 counts toward the prune and deletes the row at the tenth in a row (`rejected`);
 * - 401, 403 and 413 record the failure but never count or delete, because the push service refused
 *   this instance, not the device (`instance`);
 * - everything else is `retry`, which records the failure only when `recordTransientFailure` says
 *   no further attempt follows.
 *
 * Returns the class so the caller decides whether to retry.
 */
export const sendToSubscription = async ({
  subscription,
  payload,
  ttl,
  urgency,
  topic,
  recordTransientFailure,
}: {
  subscription: SendableSubscription;
  payload: WebPushMessage;
  /** Seconds the push service keeps the message for an offline device */
  ttl: number;
  urgency: PushUrgency;
  /** Lets the push service coalesce a retry with its pending original; up to 32 URL-safe base64 characters */
  topic: string;
  /** True on the last attempt of a delivery (or on a path without retries) */
  recordTransientFailure: boolean;
}): Promise<SendResultKind> => {
  const config = getWebPushConfig();
  const host = hostOf({ endpoint: subscription.endpoint });

  if (!config) {
    logger.warn(`[Web Push] Not sending to subscription ${subscription.id}: Web Push is not configured`);
    return 'instance';
  }

  if (subscription.vapidKeyId !== config.keyId) {
    await PushSubscriptions.destroy({ where: { id: subscription.id }, transaction: null });
    logger.info(`[Web Push] Removed subscription ${subscription.id} made under another VAPID key`);
    return 'gone';
  }

  if (!isPushEndpointAllowed({ endpoint: subscription.endpoint })) {
    logger.warn(`[Web Push] Subscription ${subscription.id} has an endpoint on ${host} that is not allowed`);
    await recordFailure({ id: subscription.id, statusCode: null, countRejection: true });
    return 'rejected';
  }

  let statusCode: number | undefined;
  let kind: SendResultKind;
  try {
    const response = await sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
      {
        TTL: ttl,
        urgency,
        topic,
        timeout: REQUEST_TIMEOUT_MS,
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
      },
    );
    statusCode = response.statusCode;
    kind = classifySendResult({ statusCode });
  } catch (error) {
    statusCode = readStatusCode({ error });
    kind = classifySendResult({ error });
  }

  switch (kind) {
    case 'ok':
      await PushSubscriptions.update(
        { lastSuccessAt: new Date(), failureCount: 0 },
        { where: { id: subscription.id }, transaction: null },
      );
      break;
    case 'gone':
      await PushSubscriptions.destroy({ where: { id: subscription.id }, transaction: null });
      logger.info(`[Web Push] Removed subscription ${subscription.id} (${host} answered ${statusCode})`);
      break;
    case 'rejected':
      logger.warn(`[Web Push] ${host} rejected subscription ${subscription.id} with status ${statusCode}`);
      await recordFailure({ id: subscription.id, statusCode: statusCode ?? null, countRejection: true });
      break;
    case 'instance':
      reportInstanceFailure({ host, statusCode });
      await recordFailure({ id: subscription.id, statusCode: statusCode ?? null, countRejection: false });
      break;
    case 'retry':
      logger.warn(
        `[Web Push] ${host} did not accept the push for subscription ${subscription.id} (status ${statusCode ?? 'none'})`,
      );
      if (recordTransientFailure) {
        await recordFailure({ id: subscription.id, statusCode: statusCode ?? null, countRejection: false });
      }
      break;
  }

  return kind;
};
