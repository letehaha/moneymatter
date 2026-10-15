import { loadUserData, startFeatureTrial as startFeatureTrialApi } from '@/api';
import { isBillingEnabled, liveSubscription } from '@/common/const/billing';
import {
  FEATURES,
  FEATURE_TRIAL_LIMITS,
  SUBSCRIPTION_STATUSES,
  hasPaidPlus,
  USER_ROLES,
  UserInfoResponse,
  isTerminalSubscription,
  type Feature,
} from '@bt/shared/types';
import { differenceInCalendarDays, differenceInHours, isFuture } from 'date-fns';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

const HOURS_PER_DAY = 24;

export const useUserStore = defineStore('user', () => {
  const user = ref<UserInfoResponse | null>(null);
  const isUserExists = computed(() => Boolean(user.value));
  const isDemo = computed(() => user.value?.role === USER_ROLES.demo);
  const role = computed(() => user.value?.role ?? null);
  const canSeeBilling = computed(() => isBillingEnabled() && !isDemo.value);

  const entitlements = computed(() => user.value?.entitlements ?? null);

  const hasFeature = (feature: Feature): boolean => Boolean(entitlements.value?.features.includes(feature));

  // Demo sessions carry their own restriction tooltips, and a null entitlements means the
  // user request is still in flight — neither is a denial.
  const isFeatureGated = (feature: Feature): boolean =>
    !isDemo.value && entitlements.value !== null && !hasFeature(feature);

  /** Free tries left for a feature the plan does not cover; null when it does, or has no trial. */
  const featureTriesLeft = ({ feature }: { feature: Feature }): number | null => {
    const limit = FEATURE_TRIAL_LIMITS[feature];
    if (!limit || !entitlements.value || hasFeature(feature)) return null;

    return Math.max(0, limit - (entitlements.value.trialUsage[feature] ?? 0));
  };

  /** Days left in a started day-based feature trial; null when none is running. */
  const featureTrialDaysLeft = ({ feature }: { feature: Feature }): number | null => {
    const trial = entitlements.value?.featureTrials?.[feature];
    if (!trial || !isFuture(new Date(trial.endsAt))) return null;

    return Math.ceil(differenceInHours(new Date(trial.endsAt), new Date(), { roundingMethod: 'ceil' }) / HOURS_PER_DAY);
  };

  const startFeatureTrial = async ({ feature }: { feature: Feature }) => {
    const next = await startFeatureTrialApi({ feature });
    if (user.value) user.value.entitlements = next;
    else await loadUser();
  };

  const isReadOnly = computed(() => Boolean(entitlements.value?.readOnly));

  /** False while entitlements are still loading. */
  const hasPlus = computed(() => entitlements.value !== null && hasPaidPlus({ entitlements: entitlements.value }));

  const hasSubscriptions = computed(() => Boolean(entitlements.value?.subscriptions.length));

  const isPastDue = computed(
    () => liveSubscription({ entitlements: entitlements.value })?.status === SUBSCRIPTION_STATUSES.past_due,
  );

  const trialDaysLeft = computed<number | null>(() => {
    const value = entitlements.value;
    if (!value?.trialEndsAt || value.plan) return null;
    // A churned user is back on whatever is left of the trial, so only a live row suppresses it.
    if (value.subscriptions.some((s) => !isTerminalSubscription(s))) return null;

    return Math.max(0, differenceInCalendarDays(new Date(value.trialEndsAt), new Date()));
  });

  const budgetTrial = computed<{ state: 'active'; daysLeft: number } | { state: 'ended' } | null>(() => {
    const endsAt = entitlements.value?.budgetPlanTrialEndsAt;
    if (!endsAt) return null;
    if (isFeatureGated(FEATURES.budget_plan)) return { state: 'ended' };
    const end = new Date(endsAt);
    return isFuture(end) ? { state: 'active', daysLeft: Math.max(1, differenceInCalendarDays(end, new Date())) } : null;
  });

  const loadUser = async () => {
    user.value = await loadUserData();
  };

  return {
    user,
    isUserExists,
    isDemo,
    role,
    canSeeBilling,
    entitlements,
    hasFeature,
    isFeatureGated,
    featureTriesLeft,
    featureTrialDaysLeft,
    startFeatureTrial,
    isReadOnly,
    hasPlus,
    isPastDue,
    hasSubscriptions,
    trialDaysLeft,
    budgetTrial,
    loadUser,
  };
});
