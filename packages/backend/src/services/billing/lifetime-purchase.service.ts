import { BILLING_PROVIDERS, BILLING_TIERS, type BillingTier, isTerminalSubscription } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import { invalidateAppUserCache } from '@middlewares/better-auth';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import BillingWebhookEvents from '@models/billing-webhook-events.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';
import { findUserByEmail } from '@services/sharing/find-user-by-email.service';
import type Stripe from 'stripe';

import { sendSubscriptionWelcomeEmail } from './send-subscription-welcome-email';
import { getStripeClient } from './stripe/client';

type LifetimeCheckoutEvent = Stripe.CheckoutSessionCompletedEvent | Stripe.CheckoutSessionAsyncPaymentSucceededEvent;

const LIFETIME_EVENT_TYPES: readonly LifetimeCheckoutEvent['type'][] = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
];

export const isLifetimeCheckoutEvent = (event: Stripe.Event): event is LifetimeCheckoutEvent =>
  (LIFETIME_EVENT_TYPES as readonly string[]).includes(event.type);

/**
 * Set by hand on the Payment Link, which copies it onto every session it opens. The grant
 * stamps it, with the buyer's id, onto the PaymentIntent so a refund can find both.
 */
const LIFETIME_PLAN_KEY = 'lifetime_plan';
const LIFETIME_USER_KEY = 'userId';

const parseLifetimePlan = ({ metadata }: { metadata: Stripe.Metadata | null | undefined }): BillingTier | null => {
  const value = metadata?.[LIFETIME_PLAN_KEY];
  return value && (BILLING_TIERS as readonly string[]).includes(value) ? (value as BillingTier) : null;
};

const parseUserId = ({ value }: { value: string | null | undefined }): number | null => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

/** `client_reference_id` comes from the link URL; the checkout email is the fallback. */
const findBuyer = async ({ session }: { session: Stripe.Checkout.Session }): Promise<Users | null> => {
  const referencedId = parseUserId({ value: session.client_reference_id });
  if (referencedId) {
    const user = await Users.findByPk(referencedId);
    if (user) return user;
    logger.warn(`Lifetime checkout ${session.id} references missing user ${referencedId}, matching by email`);
  }
  const email = session.customer_details?.email ?? session.customer_email;
  return email ? ((await findUserByEmail({ email }))?.appUser ?? null) : null;
};

/** Lifetime replaces a subscription the buyer already pays for; the paid period still runs out. */
const stopRenewals = async ({ userId, stripe }: { userId: number; stripe: Stripe }): Promise<void> => {
  const live = (await BillingSubscriptions.findAll({ where: { userId } })).filter((s) => !isTerminalSubscription(s));
  for (const subscription of live) {
    if (subscription.provider === BILLING_PROVIDERS.stripe) {
      await stripe.subscriptions.update(subscription.externalSubscriptionId, { cancel_at_period_end: true });
    } else {
      captureException({
        error: new Error('Lifetime buyer still has an App Store subscription to cancel by hand'),
        context: { userId, subscriptionId: subscription.externalSubscriptionId },
      });
    }
  }
};

const grantPlan = withTransaction(
  async ({ eventId, userId, plan }: { eventId: string; userId: number; plan: BillingTier }): Promise<boolean> => {
    const [, created] = await BillingWebhookEvents.findOrCreate({ where: { eventId } });
    if (!created) return false;
    await Users.update({ plan }, { where: { id: userId } });
    return true;
  },
);

type LifetimeOutcome = 'granted' | 'duplicate' | 'ignored' | 'unmatched' | 'conflict';

/**
 * An unmatched or conflicting purchase answers 200: no retry can fix it, so it goes to
 * Sentry for a manual grant or refund instead.
 */
export async function handleLifetimePurchase({ event }: { event: LifetimeCheckoutEvent }): Promise<LifetimeOutcome> {
  const session = event.data.object;
  if (session.mode !== 'payment' || session.payment_status !== 'paid') return 'ignored';
  const plan = parseLifetimePlan({ metadata: session.metadata });
  if (!plan) {
    // Lifetime is the only one-time product, so a paid session without the marker is a mistagged link.
    captureException({
      error: new Error('Paid one-time checkout carries no valid lifetime_plan'),
      context: { eventId: event.id, sessionId: session.id, metadata: session.metadata },
    });
    return 'ignored';
  }
  // Checked before the Stripe calls: a late redelivery must not cancel a subscription taken out since.
  if (await BillingWebhookEvents.findByPk(event.id)) return 'duplicate';

  const user = await findBuyer({ session });
  if (!user) {
    captureException({
      error: new Error('Lifetime purchase matches no account'),
      context: { eventId: event.id, sessionId: session.id },
    });
    return 'unmatched';
  }
  // Any existing plan: overwriting `early_adopter` drops its Plus features, and a repeat purchase
  // would let a refund of either payment revoke the plan the other still pays for.
  if (user.plan) {
    captureException({
      error: new Error('Lifetime buyer already holds a plan'),
      context: { eventId: event.id, sessionId: session.id, userId: user.id, plan: user.plan },
    });
    return 'conflict';
  }

  const stripe = getStripeClient();
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
  if (paymentIntentId) {
    await stripe.paymentIntents.update(paymentIntentId, {
      metadata: { [LIFETIME_USER_KEY]: String(user.id), [LIFETIME_PLAN_KEY]: plan },
    });
  } else {
    captureException({
      error: new Error('Lifetime purchase has no PaymentIntent, so a refund cannot revoke it'),
      context: { eventId: event.id, sessionId: session.id, userId: user.id },
    });
  }
  await stopRenewals({ userId: user.id, stripe });

  if (!(await grantPlan({ eventId: event.id, userId: user.id, plan }))) return 'duplicate';
  if (user.authUserId) await invalidateAppUserCache({ authUserId: user.authUserId });
  await sendSubscriptionWelcomeEmail({ userId: user.id, tier: plan });
  return 'granted';
}

/** Ends the lifetime plan a lost payment bought. False when the payment bought none, or it is already gone. */
export async function revokeLifetimePurchase({
  paymentIntentId,
  stripe,
}: {
  paymentIntentId: string;
  stripe: Stripe;
}): Promise<boolean> {
  const { metadata } = await stripe.paymentIntents.retrieve(paymentIntentId);
  const plan = parseLifetimePlan({ metadata });
  const userId = parseUserId({ value: metadata[LIFETIME_USER_KEY] });
  if (!plan || !userId) return false;

  const user = await Users.findOne({ where: { id: userId, plan } });
  if (!user) {
    logger.warn(`Lifetime ${plan} payment ${paymentIntentId} lost, but user ${userId} no longer holds it`);
    return false;
  }
  await user.update({ plan: null });
  if (user.authUserId) await invalidateAppUserCache({ authUserId: user.authUserId });
  logger.info(`Lifetime ${plan} revoked for user ${userId} after losing ${paymentIntentId}`);
  return true;
}
