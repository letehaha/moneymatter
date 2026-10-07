import type { BillingCycle, BillingTier } from '@bt/shared/types';

import { trackEvent } from '../index';

/**
 * Track the first paid period of a subscription.
 */
export function trackSubscriptionStarted({
  userId,
  tier,
  billingCycle,
}: {
  userId: string | number;
  tier: BillingTier;
  billingCycle: BillingCycle;
}): void {
  trackEvent({
    userId,
    event: 'subscription_started',
    properties: {
      tier,
      billing_cycle: billingCycle,
    },
  });
}
