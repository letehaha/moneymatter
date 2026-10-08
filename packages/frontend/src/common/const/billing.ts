import { config } from '@/common/config';
import {
  BILLING_TIERS,
  isEntitledSubscription,
  isTerminalSubscription,
  type BillingCycle,
  type BillingSubscriptionSummary,
  type BillingTier,
  type Entitlements,
  type Plan,
} from '@bt/shared/types';
import { isFuture } from 'date-fns';

/**
 * Self-hosted installs have no billing. Must stay a function: a module-level const would
 * freeze before the Docker entrypoint's runtime config reaches `window.__APP_CONFIG__`.
 */
export const isBillingEnabled = (): boolean => !config.isSelfHost;

/** The row the plan card speaks for. Terminal and lapsed rows are history, kept only for the portal link. */
export const liveSubscription = ({
  entitlements,
}: {
  entitlements: Entitlements | null;
}): BillingSubscriptionSummary | null =>
  entitlements?.subscriptions.find((s) => !isTerminalSubscription(s) && isFuture(new Date(s.currentPeriodEndsAt))) ??
  null;

export type AnalyticsPlan = Plan | 'trial' | 'read_only' | 'legacy';

/** One label per user for the PostHog `plan` person property. A paid tier outranks a granted plan. */
export const analyticsPlan = ({ entitlements }: { entitlements: Entitlements }): AnalyticsPlan => {
  if (entitlements.readOnly) return 'read_only';
  const paid = entitlements.subscriptions.find((s) => isEntitledSubscription(s));
  if (paid) return paid.tier;
  if (entitlements.plan) return entitlements.plan;
  if (entitlements.trialEndsAt && isFuture(new Date(entitlements.trialEndsAt))) return 'trial';
  return 'legacy';
};

/**
 * Headline USD amounts, tax excluded. Stripe has no client-side price preview, so
 * the buyer's own currency and tax appear on the hosted checkout page instead.
 */
export const DISPLAY_PRICES: Record<BillingTier, Record<BillingCycle, number>> = {
  essential: { month: 5, year: 30 },
  plus: { month: 8, year: 55 },
};

export const yearlySavings = ({ tier }: { tier: BillingTier }): number =>
  DISPLAY_PRICES[tier].month * 12 - DISPLAY_PRICES[tier].year;

/** Largest yearly discount across tiers, as a whole percent — the cycle toggle's "save up to" hint. */
export const MAX_YEARLY_SAVINGS_PERCENT = Math.max(
  ...BILLING_TIERS.map((tier) => Math.round((yearlySavings({ tier }) / (DISPLAY_PRICES[tier].month * 12)) * 100)),
);

/** i18n keys under `settings.planBilling.tiers.<tier>.features`. Premium is a roadmap card, not for sale. */
export const FEATURE_KEYS: Record<BillingTier | 'premium', readonly string[]> = {
  essential: ['imports', 'investments', 'ownAiKey', 'backup', 'mcp', 'seats'],
  plus: ['everythingInEssential', 'bankProviders', 'ourAiKey', 'firePlanner', 'seats'],
  premium: ['everythingInPlus', 'builtInBankSync', 'realtimePrices', 'higherAiCap', 'seats'],
};

/** Preselected in the plan picker. */
export const RECOMMENDED_TIER: BillingTier = 'plus';
