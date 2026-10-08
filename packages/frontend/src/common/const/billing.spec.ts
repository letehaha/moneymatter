import { DISPLAY_PRICES, MAX_YEARLY_SAVINGS_PERCENT, analyticsPlan, yearlySavings } from '@/common/const/billing';
import type { Entitlements } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

describe('yearlySavings', () => {
  it('returns what a year costs monthly minus the yearly price', () => {
    expect(yearlySavings({ tier: 'essential' })).toBe(
      DISPLAY_PRICES.essential.month * 12 - DISPLAY_PRICES.essential.year,
    );
    expect(yearlySavings({ tier: 'plus' })).toBe(DISPLAY_PRICES.plus.month * 12 - DISPLAY_PRICES.plus.year);
  });

  it('is a positive amount for every tier, so the yearly cycle is never the worse deal', () => {
    expect(yearlySavings({ tier: 'essential' })).toBeGreaterThan(0);
    expect(yearlySavings({ tier: 'plus' })).toBeGreaterThan(0);
  });
});

describe('MAX_YEARLY_SAVINGS_PERCENT', () => {
  it('is the largest whole-percent discount across tiers', () => {
    const percents = (['essential', 'plus'] as const).map((tier) =>
      Math.round((yearlySavings({ tier }) / (DISPLAY_PRICES[tier].month * 12)) * 100),
    );

    expect(MAX_YEARLY_SAVINGS_PERCENT).toBe(Math.max(...percents));
    expect(MAX_YEARLY_SAVINGS_PERCENT).toBeLessThan(100);
  });
});

describe('analyticsPlan', () => {
  const base: Entitlements = {
    features: [],
    readOnly: false,
    seats: 2,
    plan: null,
    trialEndsAt: null,
    subscriptions: [],
    trialUsage: {},
    featureTrials: {},
  };
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
  const sub = (status: 'active' | 'canceled', endsAt: string) => ({
    externalSubscriptionId: 'sub_1',
    tier: 'plus' as const,
    status,
    billingCycle: 'month' as const,
    currentPeriodEndsAt: endsAt,
    scheduledChange: null,
  });

  it('labels every entitlement branch', () => {
    expect(analyticsPlan({ entitlements: { ...base, readOnly: true } })).toBe('read_only');
    expect(analyticsPlan({ entitlements: { ...base, plan: 'early_adopter' } })).toBe('early_adopter');
    expect(analyticsPlan({ entitlements: { ...base, subscriptions: [sub('active', inDays(10))] } })).toBe('plus');
    expect(analyticsPlan({ entitlements: { ...base, trialEndsAt: inDays(5) } })).toBe('trial');
    expect(analyticsPlan({ entitlements: base })).toBe('legacy');
  });

  it('labels a paying early adopter by the paid tier', () => {
    const paying = { ...base, plan: 'early_adopter' as const, subscriptions: [sub('active', inDays(10))] };
    expect(analyticsPlan({ entitlements: paying })).toBe('plus');
    expect(analyticsPlan({ entitlements: { ...paying, subscriptions: [sub('canceled', inDays(-1))] } })).toBe(
      'early_adopter',
    );
  });

  it('ignores lapsed subscriptions and expired trials', () => {
    expect(
      analyticsPlan({
        entitlements: { ...base, subscriptions: [sub('canceled', inDays(-1))], trialEndsAt: inDays(-1) },
      }),
    ).toBe('legacy');
  });
});
