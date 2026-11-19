import { SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

describe('PUT /subscriptions/:id currency-only change', () => {
  it.each([
    { from: 'USD', amount: 15.5, to: 'JPY', expected: 16 },
    { from: 'KWD', amount: 1.235, to: 'USD', expected: 1.24 },
  ])('re-rounds a $from $amount amount to $to decimals', async ({ from, amount, to, expected }) => {
    const subscription = await helpers.createSubscription({
      name: 'Currency switch',
      expectedAmount: amount,
      expectedCurrencyCode: from,
      frequency: SUBSCRIPTION_FREQUENCIES.monthly,
      startDate: '2025-01-01',
      raw: true,
    });

    await helpers.updateSubscription({ id: subscription.id, expectedCurrencyCode: to, raw: true });

    const updated = await helpers.getSubscriptionById({ id: subscription.id, raw: true });
    expect(updated.expectedCurrencyCode).toBe(to);
    expect(updated.expectedAmount).toBe(expected);
  });
});
