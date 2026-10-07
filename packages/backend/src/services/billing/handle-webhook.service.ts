import { SUBSCRIPTION_STATUSES } from '@bt/shared/types';
import { trackSubscriptionStarted } from '@js/utils/posthog/events';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import BillingWebhookEvents from '@models/billing-webhook-events.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';

import type { ParsedSubscriptionEvent } from './stripe/parse-webhook';

type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'stale';

/**
 * `event.created` has second granularity, so a same-second pair can arrive out of order.
 * Only `deleted` wins such a tie against a canceled row: a subscription must never be
 * resurrected by the `updated` Stripe emitted alongside the `deleted`.
 */
const isStale = ({ existing, event }: { existing: BillingSubscriptions; event: ParsedSubscriptionEvent }): boolean => {
  if (existing.providerUpdatedAt > event.providerUpdatedAt) return true;
  if (existing.providerUpdatedAt < event.providerUpdatedAt) return false;
  return existing.status === SUBSCRIPTION_STATUSES.canceled && event.eventType !== 'customer.subscription.deleted';
};

/**
 * `subscription.metadata.userId` is authoritative: our checkout session writes it
 * server-side. Subscriptions created in Stripe's dashboard carry none and map
 * through a mirrored customer id instead.
 */
const findUserId = async ({ event }: { event: ParsedSubscriptionEvent }): Promise<number | null> => {
  if (event.userId) return event.userId;

  const byCustomer = await BillingSubscriptions.findOne({
    where: { externalCustomerId: event.externalCustomerId },
    attributes: ['userId'],
    order: [['createdAt', 'DESC']],
  });
  return byCustomer?.userId ?? null;
};

interface WebhookResult {
  outcome: WebhookOutcome;
  startedForUserId?: number;
}

const handleBillingWebhookImpl = async ({ event }: { event: ParsedSubscriptionEvent }): Promise<WebhookResult> => {
  const [, created] = await BillingWebhookEvents.findOrCreate({ where: { eventId: event.eventId } });
  if (!created) return { outcome: 'duplicate' };

  const existing = await BillingSubscriptions.findOne({
    where: { externalSubscriptionId: event.externalSubscriptionId },
    lock: true,
  });
  if (existing && isStale({ existing, event })) return { outcome: 'stale' };

  let userId = existing?.userId ?? null;
  if (!existing) {
    const candidate = await findUserId({ event });
    // Account deletion cancels in Stripe and cascades the mirror rows away, so the echo
    // of that cancel still carries the metadata of a user that no longer exists.
    userId = candidate && (await Users.count({ where: { id: candidate } })) > 0 ? candidate : null;
  }
  if (!userId) {
    if (event.status === SUBSCRIPTION_STATUSES.canceled) return { outcome: 'ignored' };
    // Throwing rolls back the BillingWebhookEvents marker, so Stripe's retry of the
    // same event is processed rather than dismissed as a duplicate.
    throw new Error(
      `Billing webhook could not be mapped to a user: subscription ${event.externalSubscriptionId}, customer ${event.externalCustomerId}`,
    );
  }

  const fields = {
    externalCustomerId: event.externalCustomerId,
    status: event.status,
    tier: event.tier,
    billingCycle: event.billingCycle,
    currentPeriodEndsAt: event.currentPeriodEndsAt,
    scheduledChange: event.scheduledChange,
    providerUpdatedAt: event.providerUpdatedAt,
  };
  if (existing) {
    await existing.update(fields);
    return { outcome: 'processed' };
  }

  await BillingSubscriptions.create({
    userId,
    externalSubscriptionId: event.externalSubscriptionId,
    ...fields,
  });
  return {
    outcome: 'processed',
    ...(event.status !== SUBSCRIPTION_STATUSES.canceled && { startedForUserId: userId }),
  };
};

const handleBillingWebhookInTransaction = withTransaction(handleBillingWebhookImpl);

export const handleBillingWebhook = async ({ event }: { event: ParsedSubscriptionEvent }): Promise<WebhookOutcome> => {
  const { outcome, startedForUserId } = await handleBillingWebhookInTransaction({ event });
  // Tracked after commit so a rolled-back webhook never reports a conversion.
  if (startedForUserId) {
    trackSubscriptionStarted({ userId: startedForUserId, tier: event.tier, billingCycle: event.billingCycle });
  }
  return outcome;
};
