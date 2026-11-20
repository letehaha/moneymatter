import { NotificationTypeV2, Type } from '@apple/app-store-server-library';
import { logger } from '@js/utils/logger';

import { handleBillingWebhook } from '../handle-webhook.service';
import {
  getAppleSubscriptionState,
  toAppleEnvironment,
  verifyAppleNotification,
  verifyAppleTransaction,
} from './client';
import { resolveAppleOwner } from './resolve-owner';
import { toAppleSubscriptionEvent } from './to-subscription-event';

type NotificationOutcome = Awaited<ReturnType<typeof handleBillingWebhook>>;

/**
 * Every notification type is handled the same way: re-read the subscription from Apple
 * and mirror it. The notification itself only names which subscription changed.
 */
export async function handleAppleNotification({
  signedPayload,
}: {
  signedPayload: string;
}): Promise<NotificationOutcome> {
  const notification = await verifyAppleNotification({ signedPayload });
  const signedTransaction = notification.data?.signedTransactionInfo;
  if (notification.notificationType === NotificationTypeV2.TEST || !signedTransaction) return 'ignored';

  const transaction = await verifyAppleTransaction({ signedTransaction });
  const { originalTransactionId } = transaction;
  if (transaction.type !== Type.AUTO_RENEWABLE_SUBSCRIPTION || !originalTransactionId) return 'ignored';

  const state = await getAppleSubscriptionState({
    originalTransactionId,
    environment: toAppleEnvironment({ environment: notification.data?.environment ?? transaction.environment }),
  });
  const { owner } = await resolveAppleOwner({
    originalTransactionId,
    appAccountToken: state.transaction.appAccountToken,
  });
  // The account was deleted while its App Store subscription keeps renewing. Throwing would
  // make Apple retry every renewal for nothing; a re-signup claims it through the app's sync.
  if (owner === 'deleted') {
    logger.info(`App Store ${notification.notificationType} for ${originalTransactionId} of a deleted account`);
    return 'ignored';
  }

  // Unowned and not canceled throws in the handler, so Apple retries until the app's sync claims it.
  return handleBillingWebhook({
    event: toAppleSubscriptionEvent({
      state,
      eventId: notification.notificationUUID ? `apple:${notification.notificationUUID}` : null,
      userId: owner?.userId ?? null,
      externalCustomerId: owner?.token ?? '',
    }),
  });
}
