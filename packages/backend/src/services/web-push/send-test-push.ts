import type { SendTestPushResponse } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import PushSubscriptions from '@models/push-subscriptions.model';
import UserSettings from '@models/user-settings.model';
import { FRONTEND_BASE_URL } from '@root/config';
import { getUnreadCount } from '@services/notifications';

import { buildTestPushPayload } from './build-push-payload';
import { getWebPushConfig } from './config';
import { sendToSubscription } from './send-to-subscription';

const TEST_PUSH_TTL_SECONDS = 120;
const DEFAULT_LOCALE = 'en';
const TEST_PUSH_TOPIC = 'pushtest';

/**
 * Sends the test message to every device of the user at once and counts the outcomes: `sent`
 * (the push service accepted it), `removed` (the device is gone or was made under another VAPID
 * key, and its row is deleted) and `failed` (anything else). There is no retry on this
 * synchronous path, so a transient failure is recorded on the device right away.
 */
export const sendTestPush = async ({ userId }: { userId: number }): Promise<SendTestPushResponse> => {
  if (!getWebPushConfig()) throw new NotFoundError({ message: t({ key: 'webPush.notConfigured' }) });

  const result: SendTestPushResponse = { sent: 0, failed: 0, removed: 0 };

  const subscriptions = await PushSubscriptions.findAll({ where: { userId } });
  if (subscriptions.length === 0) return result;

  const settings = await UserSettings.findOne({ where: { userId }, attributes: ['settings'] });
  // The test message carries the real unread count, so the app badge stays as it is.
  const payload = buildTestPushPayload({
    locale: settings?.settings?.locale ?? DEFAULT_LOCALE,
    origin: FRONTEND_BASE_URL,
    unreadCount: await getUnreadCount({ userId }),
  });

  const outcomes = await Promise.allSettled(
    subscriptions.map((subscription) =>
      sendToSubscription({
        subscription,
        payload,
        ttl: TEST_PUSH_TTL_SECONDS,
        urgency: 'high',
        topic: TEST_PUSH_TOPIC,
        recordTransientFailure: true,
      }),
    ),
  );

  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') {
      logger.error({ message: '[Web Push] Test push failed unexpectedly', error: outcome.reason });
      captureException({ error: outcome.reason });
      result.failed += 1;
    } else if (outcome.value === 'ok') {
      result.sent += 1;
    } else if (outcome.value === 'gone') {
      result.removed += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
};
