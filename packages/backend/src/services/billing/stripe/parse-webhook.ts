import {
  BILLING_PROVIDERS,
  BillingCycle,
  BillingProvider,
  BillingTier,
  SUBSCRIPTION_STATUSES,
  ScheduledChange,
  SubscriptionStatus,
  resolveTierByPriceId,
} from '@bt/shared/types';
import { captureException } from '@js/utils/sentry';
import type Stripe from 'stripe';

import { getStripeEnv } from './client';

const SUBSCRIPTION_EVENT_TYPES = [
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENT_TYPES)[number];

type StripeSubscriptionEvent = Stripe.Event & { type: SubscriptionEventType };

export const isSubscriptionEvent = (event: Stripe.Event): event is StripeSubscriptionEvent =>
  (SUBSCRIPTION_EVENT_TYPES as readonly string[]).includes(event.type);

/** An incomplete subscription has not been paid; the `updated` that activates it creates the row. */
export const isIncompleteSubscriptionEvent = (event: StripeSubscriptionEvent): boolean =>
  (event.data.object as Stripe.Subscription).status === 'incomplete';

export interface ParsedSubscriptionEvent {
  provider: BillingProvider;
  /** Dedupe key in BillingWebhookEvents. Null for a client-pushed Apple sync, which replays safely. */
  eventId: string | null;
  /** Stripe only: Apple events are re-read state, not typed deliveries. */
  eventType?: SubscriptionEventType;
  externalSubscriptionId: string;
  externalCustomerId: string;
  userId: number | null;
  status: SubscriptionStatus;
  tier: BillingTier;
  billingCycle: BillingCycle;
  currentPeriodEndsAt: Date;
  scheduledChange: ScheduledChange | null;
  providerUpdatedAt: Date;
}

/** A subscription that will never charge again is mirrored as `canceled`, whatever Stripe calls it. */
const STATUS_MAP: Record<Stripe.Subscription.Status, SubscriptionStatus> = {
  active: SUBSCRIPTION_STATUSES.active,
  trialing: SUBSCRIPTION_STATUSES.trialing,
  past_due: SUBSCRIPTION_STATUSES.past_due,
  paused: SUBSCRIPTION_STATUSES.paused,
  canceled: SUBSCRIPTION_STATUSES.canceled,
  unpaid: SUBSCRIPTION_STATUSES.canceled,
  incomplete: SUBSCRIPTION_STATUSES.canceled,
  incomplete_expired: SUBSCRIPTION_STATUSES.canceled,
};

const toDate = (unixSeconds: number | null | undefined): Date | null =>
  typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;

const parseScheduledChange = ({
  subscription,
  periodEnd,
}: {
  subscription: Stripe.Subscription;
  periodEnd: Date;
}): ScheduledChange | null => {
  if (subscription.pause_collection) {
    const resumesAt = toDate(subscription.pause_collection.resumes_at);
    return resumesAt ? { action: 'resume', effectiveAt: resumesAt.toISOString() } : null;
  }
  // Flexible billing mode reports a period-end cancel as `cancel_at` alone; the classic
  // shape is `cancel_at_period_end` with no date, and then the period end is the date.
  const cancelAt = toDate(subscription.cancel_at) ?? (subscription.cancel_at_period_end ? periodEnd : null);
  return cancelAt ? { action: 'cancel', effectiveAt: cancelAt.toISOString() } : null;
};

/** `current_period_end` lives on the item since API 2025-03-31; older payloads carry it on the subscription. */
const resolvePeriodEnd = ({ subscription }: { subscription: Stripe.Subscription }): Date => {
  const item = subscription.items.data[0];
  const periodEnd =
    toDate(item?.current_period_end) ??
    toDate((subscription as Stripe.Subscription & { current_period_end?: number }).current_period_end);
  if (!periodEnd) throw new Error(`Stripe subscription ${subscription.id} carries no current_period_end`);
  return periodEnd;
};

export function parseStripeWebhook({ event }: { event: StripeSubscriptionEvent }): ParsedSubscriptionEvent {
  const subscription = event.data.object as Stripe.Subscription;

  const priceId = subscription.items.data[0]?.price?.id ?? '';
  const resolved = resolveTierByPriceId({ env: getStripeEnv(), priceId });
  if (!resolved) throw new Error(`Unknown Stripe price id "${priceId}" on ${subscription.id}`);

  const mapped: SubscriptionStatus | undefined = STATUS_MAP[subscription.status];
  if (!mapped) throw new Error(`Unknown Stripe subscription status "${subscription.status}"`);
  // A `pause_collection` object means Stripe has stopped collecting even though the
  // subscription itself still reads `active`.
  const status =
    mapped === SUBSCRIPTION_STATUSES.active && subscription.pause_collection ? SUBSCRIPTION_STATUSES.paused : mapped;

  const externalCustomerId =
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  if (!externalCustomerId) throw new Error(`Stripe subscription ${subscription.id} carries no customer id`);

  // Written server-side when the checkout session is created, so it is trusted.
  const claimed = subscription.metadata?.userId;
  const claimedUserId = claimed && Number.isInteger(Number(claimed)) ? Number(claimed) : null;
  if (claimed && claimedUserId === null) {
    captureException({
      error: new Error(`Stripe subscription metadata.userId is not an integer: "${claimed}"`),
      context: { subscriptionId: subscription.id },
    });
  }

  const currentPeriodEndsAt = resolvePeriodEnd({ subscription });

  return {
    provider: BILLING_PROVIDERS.stripe,
    eventId: event.id,
    eventType: event.type,
    externalSubscriptionId: subscription.id,
    externalCustomerId,
    userId: claimedUserId,
    status,
    tier: resolved.tier,
    billingCycle: resolved.billingCycle,
    currentPeriodEndsAt,
    scheduledChange: parseScheduledChange({ subscription, periodEnd: currentPeriodEndsAt }),
    providerUpdatedAt: new Date(event.created * 1000),
  };
}
