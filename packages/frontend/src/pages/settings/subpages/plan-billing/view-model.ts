import { DISPLAY_PRICES, RECOMMENDED_TIER, liveSubscription, yearlySavings } from '@/common/const/billing';
import type { Variant as StatusBadgeVariant } from '@/components/lib/ui/status-badge';
import {
  BILLING_PROVIDERS,
  BILLING_TIERS,
  PLANS,
  SUBSCRIPTION_STATUSES,
  TRIAL_DAYS,
  isEntitledSubscription,
  isTerminalSubscription,
  type BillingCycle,
  type BillingSubscriptionSummary,
  type BillingTier,
  type Entitlements,
} from '@bt/shared/types';

const TRIAL_URGENT_DAYS = 7;

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  trailingZeroDisplay: 'stripIfInteger',
});

export const formatUsd = (amount: number): string => USD.format(amount);

/** `useI18n().t`, narrowed to the two shapes this page needs: named params and a plural count. */
export type Translate = (key: string, params?: Record<string, unknown> | number) => string;

interface StatusView {
  tone: 'info' | 'warning' | 'destructive' | null;
  title: string;
  badge: { variant: StatusBadgeVariant; label: string } | null;
  meta: string[];
  note: string;
}

/** Everything the request needs, so the page never derives a tier or cycle of its own. */
type TierAction =
  | { kind: 'checkout'; tier: BillingTier; cycle: BillingCycle }
  | { kind: 'portal'; flow?: 'subscription_update'; tier: BillingTier }
  | { kind: 'appStore' };

interface TierCta {
  label: string;
  variant: 'default' | 'outline';
  disabled: boolean;
  note: string;
  action: TierAction | null;
}

interface TierView {
  isCurrent: boolean;
  isRecommended: boolean;
  cta: TierCta;
}

interface TrialProgress {
  used: number;
  total: number;
  left: number;
  percent: number;
  urgent: boolean;
}

export interface PlanBillingViewInput {
  entitlements: Entitlements | null;
  selectedCycle: BillingCycle;
  checkoutSucceeded: boolean;
  activationOutcome: 'timedOut' | 'unreachable' | null;
  trialDaysLeft: number | null;
  t: Translate;
  formatDate: (iso: string) => string;
}

interface PlanBillingView {
  status: StatusView | null;
  trialProgress: TrialProgress | null;
  activeTier: BillingTier | null;
  lastTier: BillingTier | null;
  /** Plan changes, cancelation and payment happen in the App Store, never through checkout or the portal. */
  managedByAppStore: boolean;
  hasAppStoreSubscription: boolean;
  hasStripeSubscription: boolean;
  tiers: Record<BillingTier, TierView>;
}

export const buildPlanBillingView = ({
  entitlements,
  selectedCycle,
  checkoutSucceeded,
  activationOutcome,
  trialDaysLeft,
  t,
  formatDate,
}: PlanBillingViewInput): PlanBillingView => {
  const tr = (key: string, params?: Record<string, unknown> | number) => t(`settings.planBilling.${key}`, params);

  const subscription = liveSubscription({ entitlements });
  const hasSubscriptions = Boolean(entitlements?.subscriptions.length);
  const lastTier = subscription ? null : (entitlements?.subscriptions.find(isTerminalSubscription)?.tier ?? null);

  const activeTier =
    subscription &&
    isEntitledSubscription({ status: subscription.status, currentPeriodEndsAt: subscription.currentPeriodEndsAt })
      ? subscription.tier
      : null;
  const isActivating = checkoutSucceeded && !activeTier;
  const managedByAppStore = subscription?.provider === BILLING_PROVIDERS.apple;
  const hasProvider = (provider: BillingSubscriptionSummary['provider']) =>
    Boolean(entitlements?.subscriptions.some((sub) => sub.provider === provider));
  const plan = entitlements?.plan ?? null;
  const isEarlyAdopter = plan === PLANS.early_adopter;

  // Monthly and yearly are separate plans in the picker; only the exact one the user pays for is current.
  const isCurrent = (tier: BillingTier) =>
    plan === tier || (activeTier === tier && subscription?.billingCycle === selectedCycle);
  const isRecommended = (tier: BillingTier) => !activeTier && !plan && tier === (lastTier ?? RECOMMENDED_TIER);

  // App Store prices are set per storefront in App Store Connect, so the web price would be wrong.
  const subscriptionAmount = (sub: BillingSubscriptionSummary) =>
    sub.provider === BILLING_PROVIDERS.apple
      ? tr('current.billedByAppStore')
      : `${formatUsd(DISPLAY_PRICES[sub.tier][sub.billingCycle])} ${tr(`perCycle.${sub.billingCycle}`)}`;

  const buildStatus = (): StatusView | null => {
    if (!entitlements) return null;

    if (activationOutcome) {
      return {
        tone: 'info',
        title: tr('current.activating'),
        badge: { variant: 'info', label: tr('status.processing') },
        meta: [],
        note: tr(activationOutcome === 'unreachable' ? 'current.activationUnreachable' : 'current.activationTimedOut'),
      };
    }

    if (isActivating) {
      return {
        tone: 'info',
        title: tr('current.activating'),
        badge: { variant: 'info', label: tr('status.processing') },
        meta: [tr('current.activatingNote')],
        note: '',
      };
    }

    if (subscription) {
      const title = tr('current.subscription', {
        tier: tr(`plans.${subscription.tier}`),
        cycle: tr(`cycle.${subscription.billingCycle}`),
      });
      const amount = subscriptionAmount(subscription);
      const endsAt = subscription.scheduledChange?.effectiveAt ?? subscription.currentPeriodEndsAt;
      const date = endsAt ? formatDate(endsAt) : '';

      if (subscription.status === SUBSCRIPTION_STATUSES.past_due) {
        return {
          tone: 'destructive',
          title,
          badge: { variant: 'destructive', label: tr('status.pastDue') },
          meta: [date && tr('current.accessContinuesUntil', { date }), amount].filter(Boolean) as string[],
          note: date ? tr('pastDueNote', { date }) : '',
        };
      }
      if (subscription.status === SUBSCRIPTION_STATUSES.paused) {
        return {
          tone: 'warning',
          title,
          badge: { variant: 'warning', label: tr('status.paused') },
          meta: [date && tr('current.resumesOn', { date }), amount].filter(Boolean) as string[],
          note: tr('current.pausedNote'),
        };
      }
      if (subscription.scheduledChange?.action === 'cancel') {
        return {
          tone: 'warning',
          title,
          badge: date
            ? { variant: 'warning', label: tr('status.endsOn', { date }) }
            : { variant: 'warning', label: tr('status.active') },
          meta: date
            ? [tr('current.accessUntil', { date }), tr('current.noFurtherCharges')]
            : [tr('current.noFurtherCharges')],
          note: tr('current.cancelNote'),
        };
      }
      return {
        tone: null,
        title,
        badge: { variant: 'success', label: tr('status.active') },
        meta: [date && tr('current.renewsOn', { date }), amount, tr('current.seats', entitlements.seats)].filter(
          Boolean,
        ) as string[],
        note:
          subscription.billingCycle === 'month' && !managedByAppStore
            ? tr('current.monthlyHint', { amount: formatUsd(yearlySavings({ tier: subscription.tier })) })
            : '',
      };
    }

    if (plan) {
      return {
        tone: null,
        title: tr('current.lifetime', { plan: tr(`plans.${plan}`) }),
        badge: { variant: 'success', label: tr('status.earlyAdopter') },
        meta: [tr('current.lifetimeMeta'), tr('current.seats', entitlements.seats)],
        note: isEarlyAdopter ? tr('current.earlyAdopterNote') : '',
      };
    }

    if (entitlements.readOnly) {
      return {
        tone: 'warning',
        title: tr(hasSubscriptions ? 'current.subscriptionEnded' : 'current.trialEnded'),
        badge: { variant: 'warning', label: tr('status.readOnly') },
        meta: [tr(hasSubscriptions ? 'current.endedMeta' : 'current.trialEndedMeta', { days: TRIAL_DAYS })],
        note: '',
      };
    }

    if (trialDaysLeft !== null) {
      return {
        tone: 'info',
        title: tr('current.trial', trialDaysLeft),
        badge: { variant: 'info', label: tr('status.trial') },
        meta: [
          entitlements.trialEndsAt && tr('current.trialEndsOn', { date: formatDate(entitlements.trialEndsAt) }),
          tr('current.noCard'),
          tr('current.trialExcluded'),
        ].filter(Boolean) as string[],
        note: '',
      };
    }

    return null;
  };

  const buildTrialProgress = (): TrialProgress | null => {
    if (trialDaysLeft === null || subscription || entitlements?.readOnly || isActivating) return null;
    const used = TRIAL_DAYS - trialDaysLeft;
    return {
      used,
      total: TRIAL_DAYS,
      left: trialDaysLeft,
      percent: (used / TRIAL_DAYS) * 100,
      urgent: trialDaysLeft <= TRIAL_URGENT_DAYS,
    };
  };

  const buildCta = (tier: BillingTier): TierCta => {
    const tierName = tr(`tiers.${tier}.name`);

    if (isActivating)
      return { label: tr('cta.activating'), variant: 'outline', disabled: true, note: '', action: null };
    if (isCurrent(tier)) {
      return {
        label: tr('currentPlan'),
        variant: 'outline',
        disabled: true,
        note: subscription?.status === SUBSCRIPTION_STATUSES.past_due ? tr('ctaNote.keepIt') : '',
        action: null,
      };
    }
    if (managedByAppStore) {
      return {
        label: tr('manageInAppStore'),
        variant: 'outline',
        disabled: false,
        note: tr('ctaNote.viaAppStore'),
        action: { kind: 'appStore' },
      };
    }
    if (activeTier) {
      return {
        label:
          activeTier === tier
            ? tr('cta.switchToCycle', { cycle: tr(`cycle.${selectedCycle}`) })
            : tr('cta.switchTo', { tier: tierName }),
        variant: tier === RECOMMENDED_TIER ? 'default' : 'outline',
        disabled: false,
        note: tr('ctaNote.viaPortal'),
        action: { kind: 'portal', flow: 'subscription_update', tier },
      };
    }
    if (subscription) {
      return {
        label: tr('manageBilling'),
        variant: 'outline',
        disabled: false,
        note: tr('ctaNote.viaPortal'),
        action: { kind: 'portal', tier },
      };
    }
    return {
      label: lastTier === tier ? tr('cta.subscribeAgain') : tr('cta.getTier', { tier: tierName }),
      variant: isRecommended(tier) ? 'default' : 'outline',
      disabled: false,
      note: tr(isEarlyAdopter ? 'ctaNote.earlyAdopter' : 'ctaNote.billedToday'),
      action: { kind: 'checkout', tier, cycle: selectedCycle },
    };
  };

  const tiers = BILLING_TIERS.reduce(
    (acc, tier) => {
      acc[tier] = { isCurrent: isCurrent(tier), isRecommended: isRecommended(tier), cta: buildCta(tier) };
      return acc;
    },
    {} as Record<BillingTier, TierView>,
  );

  return {
    status: buildStatus(),
    trialProgress: buildTrialProgress(),
    activeTier,
    lastTier,
    managedByAppStore,
    hasAppStoreSubscription: hasProvider(BILLING_PROVIDERS.apple),
    hasStripeSubscription: hasProvider(BILLING_PROVIDERS.stripe),
    tiers,
  };
};
