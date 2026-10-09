import {
  BillingCycle,
  BillingTier,
  PLANS,
  Plan,
  STRIPE_PRICE_IDS,
  isTerminalStripeStatus,
  isTerminalSubscription,
} from '@bt/shared/types';
import { ValidationError } from '@js/errors';
import { captureException } from '@js/utils/sentry';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import { PLAN_BILLING_URL } from '@root/config';
import { getEmailForUser } from '@services/sharing/find-user-by-email.service';

import { getStripeClient, getStripeEnv } from './stripe/client';

const ALREADY_SUBSCRIBED = 'Already subscribed. Use the billing portal to change the plan.';
/** Created by hand under this fixed id in both Stripe modes, so no per-mode map. */
const EARLY_ADOPTER_COUPON_ID = 'early_adopter_50';

/**
 * Stripe-hosted checkout with Managed Payments: Stripe is the merchant of record,
 * so tax and payment methods are resolved on its page, not here.
 */
export async function createCheckoutSession({
  userId,
  plan,
  tier,
  cycle,
}: {
  userId: number;
  plan: Plan | null;
  tier: BillingTier;
  cycle: BillingCycle;
}): Promise<{ url: string }> {
  // Early adopters own Plus frozen at launch; what ships after is paid, at half price for life.
  if (plan === tier) {
    throw new ValidationError({ message: 'You already own this plan for life.' });
  }

  const priceId = STRIPE_PRICE_IDS[getStripeEnv()][tier][cycle];
  if (!priceId) throw new Error(`No Stripe price id configured for ${tier}.${cycle}`);

  // Latest row carries the customer to reuse; any non-terminal row means changes go through the portal.
  const subscriptions = await BillingSubscriptions.findAll({
    where: { userId },
    attributes: ['externalCustomerId', 'status'],
    order: [['createdAt', 'DESC']],
  });
  if (subscriptions.some((s) => !isTerminalSubscription(s))) {
    throw new ValidationError({ message: ALREADY_SUBSCRIBED });
  }

  const customerId = subscriptions[0]?.externalCustomerId;
  const customerParams: { customer?: string; customer_email?: string } = {};
  if (customerId) {
    customerParams.customer = customerId;
    // The mirror only catches up on the webhook, so a second tab would pass the check above.
    const live = await getStripeClient().subscriptions.list({ customer: customerId, status: 'all', limit: 5 });
    if (live.data.some((s) => !isTerminalStripeStatus(s))) {
      throw new ValidationError({ message: ALREADY_SUBSCRIBED });
    }
  }
  if (!customerId) {
    const email = await getEmailForUser({ userId });
    if (email) {
      customerParams.customer_email = email;
    } else {
      captureException({ error: new Error('Checkout has no email to hand Stripe'), context: { userId } });
    }
  }

  const session = await getStripeClient().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    managed_payments: { enabled: true },
    client_reference_id: String(userId),
    subscription_data: { metadata: { userId: String(userId) } },
    ...customerParams,
    // Stripe rejects a session that carries both `discounts` and `allow_promotion_codes`.
    ...(plan === PLANS.early_adopter
      ? { discounts: [{ coupon: EARLY_ADOPTER_COUPON_ID }] }
      : { allow_promotion_codes: true }),
    success_url: `${PLAN_BILLING_URL}?checkout=success`,
    cancel_url: PLAN_BILLING_URL,
  });

  if (!session.url) throw new Error(`Stripe checkout session ${session.id} has no url`);
  return { url: session.url };
}
