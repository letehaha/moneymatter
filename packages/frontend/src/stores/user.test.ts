import { startFeatureTrial as startFeatureTrialApi } from '@/api';
import {
  FEATURES,
  FEATURE_TRIAL_LIMITS,
  SUBSCRIPTION_STATUSES,
  USER_ROLES,
  type BillingSubscriptionSummary,
  type Entitlements,
  type SubscriptionStatus,
} from '@bt/shared/types';
import { ADMIN_USER, DEMO_USER, USER } from '@tests/mocks';
import { addDays, addHours, addMinutes } from 'date-fns';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserStore } from './user';

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

const buildSubscription = ({
  status,
  currentPeriodEndsAt = addDays(new Date(), 30).toISOString(),
}: {
  status: SubscriptionStatus;
  currentPeriodEndsAt?: string;
}): BillingSubscriptionSummary => ({
  provider: 'stripe',
  externalSubscriptionId: `sub_${status}`,
  tier: 'plus',
  status,
  billingCycle: 'month',
  currentPeriodEndsAt,
  scheduledChange: null,
});

const userWith = (entitlements: Entitlements) => ({ ...USER, entitlements });

// Mock the API module
vi.mock('@/api', () => ({
  loadUserData: vi.fn(),
  startFeatureTrial: vi.fn(),
}));

describe('useUserStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  describe('isDemo computed property', () => {
    it('returns true when user has demo role', () => {
      const store = useUserStore();
      store.user = DEMO_USER;

      expect(store.isDemo).toBe(true);
    });

    it('returns false when user has common role', () => {
      const store = useUserStore();
      store.user = USER;

      expect(store.isDemo).toBe(false);
    });

    it('returns false when user has admin role', () => {
      const store = useUserStore();
      store.user = ADMIN_USER;

      expect(store.isDemo).toBe(false);
    });

    it('returns false when user is null', () => {
      const store = useUserStore();
      store.user = null;

      expect(store.isDemo).toBe(false);
    });
  });

  describe('role computed property', () => {
    it('returns demo role for demo user', () => {
      const store = useUserStore();
      store.user = DEMO_USER;

      expect(store.role).toBe(USER_ROLES.demo);
    });

    it('returns common role for regular user', () => {
      const store = useUserStore();
      store.user = USER;

      expect(store.role).toBe(USER_ROLES.common);
    });

    it('returns admin role for admin user', () => {
      const store = useUserStore();
      store.user = ADMIN_USER;

      expect(store.role).toBe(USER_ROLES.admin);
    });

    it('returns null when user is null', () => {
      const store = useUserStore();
      store.user = null;

      expect(store.role).toBe(null);
    });
  });

  describe('isUserExists computed property', () => {
    it('returns true when user exists', () => {
      const store = useUserStore();
      store.user = USER;

      expect(store.isUserExists).toBe(true);
    });

    it('returns false when user is null', () => {
      const store = useUserStore();
      store.user = null;

      expect(store.isUserExists).toBe(false);
    });
  });

  describe('trialDaysLeft', () => {
    it('counts the days until the trial ends', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          trialEndsAt: addDays(new Date(), 5).toISOString(),
        }),
      );

      expect(store.trialDaysLeft).toBe(5);
    });

    it('returns 0 once the trial end date has passed', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          trialEndsAt: addDays(new Date(), -3).toISOString(),
        }),
      );

      expect(store.trialDaysLeft).toBe(0);
    });

    it('returns null when no trial is running', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements());

      expect(store.trialDaysLeft).toBe(null);
    });

    it('returns null for a lifetime plan even while the trial date stands', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          trialEndsAt: addDays(new Date(), 5).toISOString(),
          plan: 'early_adopter',
        }),
      );

      expect(store.trialDaysLeft).toBe(null);
    });

    it('returns null once a live subscription exists', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          trialEndsAt: addDays(new Date(), 5).toISOString(),
          subscriptions: [buildSubscription({ status: SUBSCRIPTION_STATUSES.active })],
        }),
      );

      expect(store.trialDaysLeft).toBe(null);
    });

    it('still counts the trial when every subscription is canceled', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          trialEndsAt: addDays(new Date(), 5).toISOString(),
          subscriptions: [buildSubscription({ status: SUBSCRIPTION_STATUSES.canceled })],
        }),
      );

      expect(store.trialDaysLeft).toBe(5);
    });

    it('suppresses the trial for a paused subscription, which is not terminal', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          trialEndsAt: addDays(new Date(), 5).toISOString(),
          subscriptions: [buildSubscription({ status: SUBSCRIPTION_STATUSES.paused })],
        }),
      );

      expect(store.trialDaysLeft).toBe(null);
    });
  });

  describe('budgetTrial', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('counts the days left while the trial runs', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          features: [FEATURES.budget_plan],
          budgetPlanTrialEndsAt: addDays(new Date(), 12).toISOString(),
        }),
      );

      expect(store.budgetTrial).toEqual({ state: 'active', daysLeft: 12 });
    });

    it('reports the trial as ended once budgeting is gated', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements({ budgetPlanTrialEndsAt: addDays(new Date(), -2).toISOString() }));

      expect(store.budgetTrial).toEqual({ state: 'ended' });
    });

    it('reports the trial as ended when the server gates budgeting before the client clock reaches the end', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements({ budgetPlanTrialEndsAt: addMinutes(new Date(), 5).toISOString() }));

      expect(store.budgetTrial).toEqual({ state: 'ended' });
    });

    it('shows one day left when the trial ends later today', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 8, 25, 10));
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          features: [FEATURES.budget_plan],
          budgetPlanTrialEndsAt: new Date(2026, 8, 25, 18).toISOString(),
        }),
      );

      expect(store.budgetTrial).toEqual({ state: 'active', daysLeft: 1 });
    });

    it('returns null for a past end when budgeting is still granted', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          features: [FEATURES.budget_plan],
          budgetPlanTrialEndsAt: addDays(new Date(), -2).toISOString(),
        }),
      );

      expect(store.budgetTrial).toBeNull();
    });

    it('returns null before the trial has started', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements({ features: [FEATURES.budget_plan] }));

      expect(store.budgetTrial).toBeNull();
    });
  });

  describe('isPastDue', () => {
    it('is true for a past-due subscription whose paid period has not elapsed', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          subscriptions: [buildSubscription({ status: SUBSCRIPTION_STATUSES.past_due })],
        }),
      );

      expect(store.isPastDue).toBe(true);
    });

    it('is false once the past-due period has elapsed, since the row no longer grants access', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          subscriptions: [
            buildSubscription({
              status: SUBSCRIPTION_STATUSES.past_due,
              currentPeriodEndsAt: addDays(new Date(), -1).toISOString(),
            }),
          ],
        }),
      );

      expect(store.isPastDue).toBe(false);
    });

    it('is false for an active subscription', () => {
      const store = useUserStore();
      store.user = userWith(
        buildEntitlements({
          subscriptions: [buildSubscription({ status: SUBSCRIPTION_STATUSES.active })],
        }),
      );

      expect(store.isPastDue).toBe(false);
    });
  });

  describe('featureTriesLeft', () => {
    const limit = FEATURE_TRIAL_LIMITS[FEATURES.invoice_matching]!;

    it('counts down from the limit for a plan without the feature', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements({ trialUsage: { [FEATURES.invoice_matching]: 2 } }));

      expect(store.featureTriesLeft({ feature: FEATURES.invoice_matching })).toBe(limit - 2);
    });

    it('returns 0 once every try is spent', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements({ trialUsage: { [FEATURES.invoice_matching]: limit + 1 } }));

      expect(store.featureTriesLeft({ feature: FEATURES.invoice_matching })).toBe(0);
    });

    it('returns null when the plan already includes the feature', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements({ features: [FEATURES.invoice_matching] }));

      expect(store.featureTriesLeft({ feature: FEATURES.invoice_matching })).toBeNull();
    });

    it('returns null for a feature with no trial', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements());

      expect(store.featureTriesLeft({ feature: FEATURES.bank_providers })).toBeNull();
    });
  });

  describe('featureTrialDaysLeft', () => {
    const feature = FEATURES.fire_planner;
    const trialEndingIn = ({ days }: { days: number }) => ({
      [feature]: { startedAt: new Date().toISOString(), endsAt: addDays(new Date(), days).toISOString() },
    });

    it('counts the days until the trial ends', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements({ features: [feature], featureTrials: trialEndingIn({ days: 3 }) }));

      expect(store.featureTrialDaysLeft({ feature })).toBe(3);
    });

    it('returns null once the trial has expired', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements({ featureTrials: trialEndingIn({ days: -1 }) }));

      expect(store.featureTrialDaysLeft({ feature })).toBeNull();
    });

    it('returns null when no trial was started', () => {
      const store = useUserStore();
      store.user = userWith(buildEntitlements());

      expect(store.featureTrialDaysLeft({ feature })).toBeNull();
    });

    describe('partial days', () => {
      const now = new Date('2026-09-25T12:00:00Z');

      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it.each([
        [1, 1],
        [60, 3],
      ])('rounds %d hours left up to %d days', (hours, expected) => {
        const store = useUserStore();
        store.user = userWith(
          buildEntitlements({
            featureTrials: { [feature]: { startedAt: now.toISOString(), endsAt: addHours(now, hours).toISOString() } },
          }),
        );

        expect(store.featureTrialDaysLeft({ feature })).toBe(expected);
      });
    });
  });

  describe('startFeatureTrial', () => {
    const feature = FEATURES.fire_planner;

    it('replaces the entitlements with the response', async () => {
      const next = buildEntitlements({ features: [feature] });
      vi.mocked(startFeatureTrialApi).mockResolvedValueOnce(next);
      const store = useUserStore();
      store.user = userWith(buildEntitlements());

      await store.startFeatureTrial({ feature });

      expect(store.entitlements).toEqual(next);
    });

    it('keeps the entitlements and rethrows when the request fails', async () => {
      const error = new Error('failed');
      vi.mocked(startFeatureTrialApi).mockRejectedValueOnce(error);
      const store = useUserStore();
      const current = buildEntitlements();
      store.user = userWith(current);

      await expect(store.startFeatureTrial({ feature })).rejects.toBe(error);
      expect(store.entitlements).toEqual(current);
    });
  });
});
