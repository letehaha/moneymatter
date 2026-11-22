import planBillingEn from '@/i18n/locales/chunks/en/settings/plan-billing.json';
import planBillingUk from '@/i18n/locales/chunks/uk/settings/plan-billing.json';
import {
  PROMOTIONS,
  SUBSCRIPTION_STATUSES,
  type BillingSubscriptionSummary,
  type Entitlements,
  type SubscriptionStatus,
} from '@bt/shared/types';
import { addDays, format } from 'date-fns';
import { describe, expect, it } from 'vitest';

import { buildPlanBillingView, formatUsd, type PlanBillingViewInput } from './view-model';

const buildEntitlements = (overrides: Partial<Entitlements> = {}): Entitlements => ({
  features: [],
  readOnly: false,
  seats: 1,
  plan: null,
  trialEndsAt: null,
  budgetPlanTrialEndsAt: null,
  subscriptions: [],
  trialUsage: {},
  featureTrials: {},
  ...overrides,
});

const buildSubscription = (overrides: Partial<BillingSubscriptionSummary> = {}): BillingSubscriptionSummary => ({
  provider: 'stripe',
  externalSubscriptionId: 'sub_1',
  tier: 'essential',
  status: SUBSCRIPTION_STATUSES.active as SubscriptionStatus,
  billingCycle: 'month',
  currentPeriodEndsAt: addDays(new Date(), 30).toISOString(),
  scheduledChange: null,
  ...overrides,
});

const buildView = (overrides: Partial<PlanBillingViewInput> = {}) =>
  buildPlanBillingView({
    entitlements: buildEntitlements(),
    selectedCycle: 'year',
    checkoutSucceeded: false,
    activationOutcome: null,
    trialDaysLeft: null,
    t: (key) => key,
    formatDate: (iso) => iso.slice(0, 10),
    now: new Date('2020-01-01T00:00:00.000Z'),
    ...overrides,
  });

describe('buildPlanBillingView', () => {
  it('does not mark a monthly plan as current while the yearly tab is selected', () => {
    const entitlements = buildEntitlements({ subscriptions: [buildSubscription({ billingCycle: 'month' })] });

    expect(buildView({ entitlements, selectedCycle: 'year' }).tiers.essential.isCurrent).toBe(false);
    expect(buildView({ entitlements, selectedCycle: 'month' }).tiers.essential.isCurrent).toBe(true);
  });

  it('stops showing the activating state once the subscription lands', () => {
    const activating = buildView({ checkoutSucceeded: true });
    expect(activating.status?.badge?.label).toBe('settings.planBilling.status.processing');

    const landed = buildView({
      checkoutSucceeded: true,
      entitlements: buildEntitlements({ subscriptions: [buildSubscription()] }),
      selectedCycle: 'month',
    });
    expect(landed.activeTier).toBe('essential');
    expect(landed.status?.badge?.label).toBe('settings.planBilling.status.active');
  });

  it('renders a past-due subscription in the destructive tone', () => {
    const view = buildView({
      entitlements: buildEntitlements({
        subscriptions: [buildSubscription({ status: SUBSCRIPTION_STATUSES.past_due })],
      }),
    });

    expect(view.status?.tone).toBe('destructive');
    expect(view.status?.badge?.label).toBe('settings.planBilling.status.pastDue');
    expect(view.status?.note).toBe('settings.planBilling.pastDueNote');
  });

  it('badges a scheduled cancellation with its end date', () => {
    const view = buildView({
      entitlements: buildEntitlements({
        subscriptions: [
          buildSubscription({ scheduledChange: { action: 'cancel', effectiveAt: '2026-05-01T00:00:00.000Z' } }),
        ],
      }),
    });

    expect(view.status?.tone).toBe('warning');
    expect(view.status?.badge?.label).toBe('settings.planBilling.status.endsOn');
  });

  it('falls back to the plain active badge when a scheduled cancellation has no date', () => {
    const view = buildView({
      entitlements: buildEntitlements({
        subscriptions: [
          buildSubscription({
            scheduledChange: { action: 'cancel', effectiveAt: '' },
          }),
        ],
      }),
    });

    expect(view.status?.badge?.label).toBe('settings.planBilling.status.active');
  });

  it('offers to subscribe again to the tier a canceled row was on', () => {
    const view = buildView({
      entitlements: buildEntitlements({
        subscriptions: [
          buildSubscription({
            status: SUBSCRIPTION_STATUSES.canceled,
            tier: 'plus',
          }),
        ],
        readOnly: true,
      }),
    });

    expect(view.lastTier).toBe('plus');
    expect(view.tiers.plus.isRecommended).toBe(true);
    expect(view.tiers.plus.cta.label).toBe('settings.planBilling.cta.subscribeAgain');
    expect(view.tiers.essential.cta.label).toBe('settings.planBilling.cta.getTier');
  });

  it('treats a lapsed subscription as ended so a read-only user can resubscribe', () => {
    const view = buildView({
      entitlements: buildEntitlements({
        readOnly: true,
        subscriptions: [buildSubscription({ currentPeriodEndsAt: addDays(new Date(), -1).toISOString() })],
      }),
    });

    expect(view.activeTier).toBe(null);
    expect(view.status?.title).toBe('settings.planBilling.current.subscriptionEnded');
    expect(view.status?.badge?.label).toBe('settings.planBilling.status.readOnly');
    expect(view.tiers.essential.cta.action).toEqual({
      kind: 'checkout',
      tier: 'essential',
      cycle: 'year',
    });
  });

  it('shows an info card when activation timed out', () => {
    const view = buildView({ activationOutcome: 'timedOut' });

    expect(view.status?.tone).toBe('info');
    expect(view.status?.note).toBe('settings.planBilling.current.activationTimedOut');
  });

  it('has no status card before the user is loaded', () => {
    expect(buildView({ entitlements: null }).status).toBe(null);
  });

  it('lets an early adopter buy either tier at the lifetime discount', () => {
    const view = buildView({
      entitlements: buildEntitlements({ plan: 'early_adopter' }),
    });

    expect(view.status?.title).toBe('settings.planBilling.current.lifetime');
    expect(view.status?.badge?.label).toBe('settings.planBilling.status.earlyAdopter');
    expect(view.status?.note).toBe('settings.planBilling.current.earlyAdopterNote');
    expect(view.tiers.plus.isRecommended).toBe(false);
    expect(view.tiers.plus.isCurrent).toBe(false);
    expect(view.tiers.plus.cta.action).toEqual({ kind: 'checkout', tier: 'plus', cycle: 'year' });
    expect(view.tiers.plus.cta.note).toBe('settings.planBilling.ctaNote.earlyAdopter');
  });

  it('marks a comped tier as current and sells the other one at full price', () => {
    const view = buildView({
      entitlements: buildEntitlements({ plan: 'essential' }),
    });

    expect(view.status?.note).toBe('');
    expect(view.status?.badge?.label).toBe('settings.planBilling.status.active');
    expect(view.status?.meta[0]).toBe('settings.planBilling.current.lifetimePurchaseMeta');
    expect(view.tiers.essential.isCurrent).toBe(true);
    expect(view.tiers.essential.cta.disabled).toBe(true);
    expect(view.tiers.plus.cta.action).toEqual({ kind: 'checkout', tier: 'plus', cycle: 'year' });
    expect(view.tiers.plus.cta.note).toBe('settings.planBilling.ctaNote.billedToday');
  });

  it('shows the paid subscription over the lifetime grant once an early adopter subscribes', () => {
    const view = buildView({
      entitlements: buildEntitlements({
        plan: 'early_adopter',
        subscriptions: [buildSubscription({ tier: 'plus', billingCycle: 'year' })],
      }),
    });

    expect(view.status?.title).toBe('settings.planBilling.current.subscription');
    expect(view.tiers.plus.isCurrent).toBe(true);
    expect(view.tiers.essential.cta.action).toEqual({ kind: 'portal', flow: 'subscription_update', tier: 'essential' });
  });

  it('renders a paused subscription in the warning tone and routes its CTA to the portal', () => {
    const view = buildView({
      entitlements: buildEntitlements({
        subscriptions: [buildSubscription({ status: SUBSCRIPTION_STATUSES.paused })],
      }),
      selectedCycle: 'month',
    });

    expect(view.activeTier).toBe(null);
    expect(view.status?.tone).toBe('warning');
    expect(view.status?.badge?.label).toBe('settings.planBilling.status.paused');
    expect(view.tiers.essential.cta.action).toEqual({ kind: 'portal', tier: 'essential' });
  });

  it('points an unreachable activation at its own note', () => {
    expect(buildView({ activationOutcome: 'unreachable' }).status?.note).toBe(
      'settings.planBilling.current.activationUnreachable',
    );
  });

  describe('App Store subscription', () => {
    const appStore = (overrides: Partial<BillingSubscriptionSummary> = {}) =>
      buildEntitlements({
        subscriptions: [
          buildSubscription({ provider: 'apple', externalSubscriptionId: '2000000000000001', ...overrides }),
        ],
      });

    it('shows where it is billed instead of the web price', () => {
      const view = buildView({ entitlements: appStore(), selectedCycle: 'month' });

      expect(view.managedByAppStore).toBe(true);
      expect(view.status?.meta).toContain('settings.planBilling.current.billedByAppStore');
      expect(view.status?.meta.some((item) => item.includes('$'))).toBe(false);
      expect(view.status?.note).toBe('');
    });

    it('sends every other tier to the App Store, never to checkout or the portal', () => {
      const view = buildView({ entitlements: appStore(), selectedCycle: 'month' });

      expect(view.tiers.essential.isCurrent).toBe(true);
      expect(view.tiers.essential.cta.action).toBeNull();
      expect(view.tiers.plus.cta).toMatchObject({
        label: 'settings.planBilling.manageInAppStore',
        action: { kind: 'appStore' },
      });
    });

    it('falls back to web checkout once the App Store subscription has ended', () => {
      const view = buildView({ entitlements: appStore({ status: SUBSCRIPTION_STATUSES.canceled }) });

      expect(view.managedByAppStore).toBe(false);
      expect(view.tiers.plus.cta.action).toMatchObject({ kind: 'checkout' });
    });

    it('links a lapsed App Store subscription to the App Store, never the portal', () => {
      const view = buildView({
        entitlements: appStore({
          status: SUBSCRIPTION_STATUSES.past_due,
          currentPeriodEndsAt: addDays(new Date(), -1).toISOString(),
        }),
      });

      expect(view.managedByAppStore).toBe(false);
      expect(view.hasAppStoreSubscription).toBe(true);
      expect(view.hasStripeSubscription).toBe(false);
    });

    it('offers both management links when App Store and Stripe subscriptions coexist', () => {
      const view = buildView({
        entitlements: buildEntitlements({
          subscriptions: [
            buildSubscription({ provider: 'apple', externalSubscriptionId: '2000000000000001' }),
            buildSubscription({ tier: 'plus' }),
          ],
        }),
      });

      expect(view.hasAppStoreSubscription).toBe(true);
      expect(view.hasStripeSubscription).toBe(true);
    });
  });
});

describe('formatUsd', () => {
  it('drops the cents on a whole amount and keeps them otherwise', () => {
    expect(formatUsd(30)).toBe('$30');
    expect(formatUsd(55 / 12)).toBe('$4.58');
  });
});

describe('buildPlanBillingView promotions', () => {
  const sale = PROMOTIONS.find((promotion) => promotion.id === 'blackFriday2026')!;
  const duringSale = new Date(Date.parse(sale.startsAt) + 24 * 60 * 60 * 1000);
  const afterSale = new Date(Date.parse(sale.endsAt) + 1);

  it('discounts the first payment of the selected cycle during the sale', () => {
    const yearly = buildView({ now: duringSale, selectedCycle: 'year' });
    expect(yearly.tiers.plus.promotion).toEqual({
      badge: 'settings.planBilling.promotion.badge',
      price: 38.5,
      renews: 'settings.planBilling.promotion.renews.year',
    });
    expect(yearly.tiers.essential.promotion?.price).toBe(21);
    expect(yearly.tiers.plus.cta.note).toBe('settings.planBilling.promotion.billedToday');
    expect(yearly.promotion).toEqual({
      title: 'settings.planBilling.promotion.title',
      subtitle: 'settings.planBilling.promotion.subtitle',
      percentOff: 30,
    });

    const monthly = buildView({ now: duringSale, selectedCycle: 'month' });
    expect(monthly.tiers.plus.promotion?.price).toBe(5.6);
    expect(monthly.tiers.plus.promotion?.renews).toBe('settings.planBilling.promotion.renews.month');
  });

  it('ends the banner on the UTC calendar day in any timezone', () => {
    const view = buildView({
      now: duringSale,
      t: (key, params) => `${key}:${typeof params === 'object' ? (params.date ?? '') : ''}`,
      formatDate: (iso) => format(new Date(iso), 'yyyy-MM-dd'),
    });
    expect(view.promotion?.subtitle).toBe(`settings.planBilling.promotion.subtitle:${sale.endsAt.slice(0, 10)}`);
  });

  it('names every configured promotion in en and uk', () => {
    for (const promotion of PROMOTIONS) {
      expect(planBillingEn.settings.planBilling.promotion.names).toHaveProperty(promotion.id);
      expect(planBillingUk.settings.planBilling.promotion.names).toHaveProperty(promotion.id);
    }
  });

  it('shows nothing outside the sale window', () => {
    const view = buildView({ now: afterSale });
    expect(view.tiers.plus.promotion).toBeNull();
    expect(view.promotion).toBeNull();
  });

  it('skips early adopters, who keep their own coupon', () => {
    const view = buildView({ now: duringSale, entitlements: buildEntitlements({ plan: 'early_adopter' }) });
    expect(view.tiers.plus.promotion).toBeNull();
    expect(view.tiers.essential.promotion).toBeNull();
    expect(view.promotion).toBeNull();
  });

  it('skips App Store subscribers and tiers reached through the portal', () => {
    const appStore = buildView({
      now: duringSale,
      entitlements: buildEntitlements({ subscriptions: [buildSubscription({ provider: 'apple' })] }),
    });
    expect(appStore.tiers.plus.promotion).toBeNull();
    expect(appStore.promotion).toBeNull();

    const stripe = buildView({
      now: duringSale,
      entitlements: buildEntitlements({ subscriptions: [buildSubscription({ tier: 'essential' })] }),
    });
    expect(stripe.tiers.plus.promotion).toBeNull();
    expect(stripe.promotion).toBeNull();
  });
});
