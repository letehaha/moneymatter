import { AutoRenewStatus, Status } from '@apple/app-store-server-library';
import {
  BILLING_PROVIDERS,
  SUBSCRIPTION_STATUSES,
  ScheduledChange,
  SubscriptionStatus,
  resolveTierByAppleProductId,
} from '@bt/shared/types';

import type { ParsedSubscriptionEvent } from '../stripe/parse-webhook';
import type { AppleSubscriptionState } from './client';

/** Billing retry has no access left (its period already ended); grace keeps access until `gracePeriodExpiresDate`. */
const STATUS_MAP: Record<Status, SubscriptionStatus> = {
  [Status.ACTIVE]: SUBSCRIPTION_STATUSES.active,
  [Status.BILLING_RETRY]: SUBSCRIPTION_STATUSES.past_due,
  [Status.BILLING_GRACE_PERIOD]: SUBSCRIPTION_STATUSES.past_due,
  [Status.EXPIRED]: SUBSCRIPTION_STATUSES.canceled,
  [Status.REVOKED]: SUBSCRIPTION_STATUSES.canceled,
};

export function toAppleSubscriptionEvent({
  state: { status, transaction, renewalInfo },
  eventId,
  userId,
  externalCustomerId,
}: {
  state: AppleSubscriptionState;
  eventId: string | null;
  userId: number | null;
  externalCustomerId: string;
}): ParsedSubscriptionEvent {
  const { originalTransactionId, productId, expiresDate, signedDate, revocationDate } = transaction;
  if (!originalTransactionId || !expiresDate || !signedDate) {
    throw new Error(`App Store transaction ${transaction.transactionId} is not an auto-renewable subscription`);
  }

  const resolved = resolveTierByAppleProductId({ productId });
  if (!resolved) throw new Error(`Unknown App Store product id "${productId}" on ${originalTransactionId}`);

  const mapped: SubscriptionStatus | undefined = STATUS_MAP[status];
  if (!mapped) throw new Error(`Unknown App Store subscription status "${status}" on ${originalTransactionId}`);
  // A refund or revoke ends access at once, whatever status Apple reports alongside it.
  const ourStatus = revocationDate ? SUBSCRIPTION_STATUSES.canceled : mapped;

  const grace = status === Status.BILLING_GRACE_PERIOD ? renewalInfo?.gracePeriodExpiresDate : undefined;
  const currentPeriodEndsAt = new Date(revocationDate ?? grace ?? expiresDate);

  const scheduledChange: ScheduledChange | null =
    ourStatus !== SUBSCRIPTION_STATUSES.canceled && renewalInfo?.autoRenewStatus === AutoRenewStatus.OFF
      ? { action: 'cancel', effectiveAt: new Date(expiresDate).toISOString() }
      : null;

  return {
    provider: BILLING_PROVIDERS.apple,
    eventId,
    externalSubscriptionId: originalTransactionId,
    externalCustomerId,
    userId,
    status: ourStatus,
    tier: resolved.tier,
    billingCycle: resolved.billingCycle,
    currentPeriodEndsAt,
    scheduledChange,
    providerUpdatedAt: new Date(signedDate),
  };
}
