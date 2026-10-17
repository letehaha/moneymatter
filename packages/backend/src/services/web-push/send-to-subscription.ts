import type { WebPushMessage } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import PushSubscriptions from '@models/push-subscriptions.model';
import { literal } from 'sequelize';
import { sendNotification } from 'web-push';

import { type SendResultKind, classifySendResult, readStatusCode } from './classify-send-result';
import { getWebPushConfig } from './config';
import { normalizePushEndpoint } from './endpoint-allowlist';

export type PushUrgency = 'very-low' | 'low' | 'normal' | 'high';

/** Consecutive `rejected` results after which a subscription is deleted. */
export const MAX_CONSECUTIVE_REJECTIONS = 10;

const REQUEST_TIMEOUT_MS = 10_000;

// Instance-side refusals (a bad key, clock skew, an allowlist change) repeat for every send, so
// each (host, reason) is logged once per process.
const reportedInstanceFailures = new Set<string>();

type SendableSubscription = Pick<PushSubscriptions, 'id' | 'endpoint' | 'p256dh' | 'auth' | 'vapidKeyId'>;

const hostOf = ({ endpoint }: { endpoint: string }): string => {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-endpoint';
  }
};

// Every write passes `transaction: null`: the sender runs on the worker path, where cls-hooked can
// hand a query a concurrent request's already-committed transaction.
//
// Every write is scoped to the row's id AND the endpoint the send used. A browser rotation keeps the
// id and swaps the endpoint, so a late answer for the old endpoint cannot touch the refreshed row.
const recordFailure = async ({
  id,
  endpoint,
  statusCode,
  countRejection,
}: {
  id: string;
  endpoint: string;
  statusCode: number | null;
  countRejection: boolean;
}): Promise<void> => {
  const now = new Date();

  if (!countRejection) {
    await PushSubscriptions.update(
      { lastFailureAt: now, lastFailureStatus: statusCode },
      { where: { id, endpoint }, transaction: null },
    );
    return;
  }

  const [, rows] = await PushSubscriptions.update(
    { failureCount: literal('"failureCount" + 1'), lastFailureAt: now, lastFailureStatus: statusCode },
    { where: { id, endpoint }, returning: true, transaction: null },
  );

  if (rows[0] && rows[0].failureCount >= MAX_CONSECUTIVE_REJECTIONS) {
    await PushSubscriptions.destroy({ where: { id, endpoint }, transaction: null });
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
 * - an endpoint the allowlist now refuses is `instance` without a request: the operator's
 *   `WEB_PUSH_ALLOWED_HOSTS` changed, not the device, so it never counts toward the prune;
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
    await PushSubscriptions.destroy({
      where: { id: subscription.id, endpoint: subscription.endpoint },
      transaction: null,
    });
    logger.info(`[Web Push] Removed subscription ${subscription.id} made under another VAPID key`);
    return 'gone';
  }

  // The request goes to this normalized URL, never to the stored string, so check and use cannot diverge.
  const target = normalizePushEndpoint({ endpoint: subscription.endpoint });
  if (!target) {
    const reportKey = `${host}:not-allowed`;
    if (!reportedInstanceFailures.has(reportKey)) {
      reportedInstanceFailures.add(reportKey);
      logger.warn(
        `[Web Push] Subscriptions on ${host} are not sent to: the host is not allowed by WEB_PUSH_ALLOWED_HOSTS. They are kept, not counted as rejections.`,
      );
    }
    await recordFailure({
      id: subscription.id,
      endpoint: subscription.endpoint,
      statusCode: null,
      countRejection: false,
    });
    return 'instance';
  }

  let statusCode: number | undefined;
  let kind: SendResultKind;
  try {
    const response = await sendNotification(
      { endpoint: target, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
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
      // The push service has the message. A failing write here must not fail the job: BullMQ would
      // retry it and send the same notification again.
      try {
        await PushSubscriptions.update(
          { lastSuccessAt: new Date(), failureCount: 0 },
          { where: { id: subscription.id, endpoint: subscription.endpoint }, transaction: null },
        );
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        logger.error({
          message: `[Web Push] Delivered to subscription ${subscription.id} but could not record it`,
          error: failure,
        });
        captureException({ error: failure, context: { subscriptionId: subscription.id } });
      }
      break;
    case 'gone':
      await PushSubscriptions.destroy({
        where: { id: subscription.id, endpoint: subscription.endpoint },
        transaction: null,
      });
      logger.info(`[Web Push] Removed subscription ${subscription.id} (${host} answered ${statusCode})`);
      break;
    case 'rejected':
      logger.warn(`[Web Push] ${host} rejected subscription ${subscription.id} with status ${statusCode}`);
      await recordFailure({
        id: subscription.id,
        endpoint: subscription.endpoint,
        statusCode: statusCode ?? null,
        countRejection: true,
      });
      break;
    case 'instance':
      reportInstanceFailure({ host, statusCode });
      await recordFailure({
        id: subscription.id,
        endpoint: subscription.endpoint,
        statusCode: statusCode ?? null,
        countRejection: false,
      });
      break;
    case 'retry':
      logger.warn(
        `[Web Push] ${host} did not accept the push for subscription ${subscription.id} (status ${statusCode ?? 'none'})`,
      );
      if (recordTransientFailure) {
        await recordFailure({
          id: subscription.id,
          endpoint: subscription.endpoint,
          statusCode: statusCode ?? null,
          countRejection: false,
        });
      }
      break;
  }

  return kind;
};
