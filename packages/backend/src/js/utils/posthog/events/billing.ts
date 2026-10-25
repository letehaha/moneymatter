import type { BillingCycle, BillingProvider, BillingTier } from '@bt/shared/types';

import { trackEvent } from '../index';

/**
 * Track the first paid period of a subscription.
 */
export function trackSubscriptionStarted({
  userId,
  provider,
  tier,
  billingCycle,
}: {
  userId: string | number;
  provider: BillingProvider;
  tier: BillingTier;
  billingCycle: BillingCycle;
}): void {
  trackEvent({
    userId,
    event: 'subscription_started',
    properties: {
      provider,
      tier,
      billing_cycle: billingCycle,
    },
  });
}
