import {
  SUBSCRIPTION_STATUSES,
  type BillingSubscriptionSummary,
  type Entitlements,
  type SubscriptionStatus,
} from '@bt/shared/types';
import { addDays } from 'date-fns';
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
});

describe('formatUsd', () => {
  it('drops the cents on a whole amount and keeps them otherwise', () => {
    expect(formatUsd(30)).toBe('$30');
    expect(formatUsd(55 / 12)).toBe('$4.58');
  });
});
