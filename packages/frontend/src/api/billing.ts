import { api } from '@/api/_api';
import type { BillingCycle, BillingTier, RedeemGiftResponse } from '@bt/shared/types';

/** Stripe-hosted checkout; the backend owns the URL Stripe sends the buyer back to. */
export const createBillingCheckout = async ({
  tier,
  cycle,
}: {
  tier: BillingTier;
  cycle: BillingCycle;
}): Promise<{ url: string }> => {
  return api.post('/billing/checkout', { tier, cycle }, { silent: true });
};

/**
 * Stripe-hosted customer portal — cancel, payment method, invoices, and with
 * `flow: 'subscription_update'` the plan switch too.
 */
export const createBillingPortalSession = async ({
  flow,
}: {
  flow?: 'subscription_update';
} = {}): Promise<{ url: string }> => {
  return api.post('/billing/portal', { flow }, { silent: true });
};

export const redeemGift = async ({ code }: { code: string }): Promise<RedeemGiftResponse> => {
  return api.post('/billing/gifts/redeem', { code }, { silent: true });
};
