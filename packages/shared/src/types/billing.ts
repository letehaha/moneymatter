import { AI_FEATURE } from './ai/settings';

export const PLANS = {
  essential: 'essential',
  plus: 'plus',
  early_adopter: 'early_adopter',
} as const;
export type Plan = (typeof PLANS)[keyof typeof PLANS];

/** Plans that can be bought. `early_adopter` is granted by hand, never sold. */
export type BillingTier = Exclude<Plan, typeof PLANS.early_adopter>;
export const BILLING_TIERS = [PLANS.essential, PLANS.plus] as const satisfies readonly BillingTier[];

export const BILLING_CYCLES = { month: 'month', year: 'year' } as const;
export type BillingCycle = (typeof BILLING_CYCLES)[keyof typeof BILLING_CYCLES];

export const SUBSCRIPTION_STATUSES = {
  active: 'active',
  trialing: 'trialing',
  past_due: 'past_due',
  paused: 'paused',
  canceled: 'canceled',
} as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[keyof typeof SUBSCRIPTION_STATUSES];

/** Statuses that still grant access while `currentPeriodEndsAt` is in the future. */
const ENTITLED_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  SUBSCRIPTION_STATUSES.active,
  SUBSCRIPTION_STATUSES.trialing,
  SUBSCRIPTION_STATUSES.past_due,
];

/** A mirrored subscription never leaves `canceled`: it will never charge again and Stripe rejects mutating it. */
export const TERMINAL_SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [SUBSCRIPTION_STATUSES.canceled];

export const isTerminalSubscription = ({ status }: { status: SubscriptionStatus }): boolean =>
  TERMINAL_SUBSCRIPTION_STATUSES.includes(status);

/** Raw Stripe statuses that all mirror as `canceled`. For call sites reading a Stripe object directly. */
export const STRIPE_TERMINAL_STATUSES: readonly string[] = ['canceled', 'unpaid', 'incomplete', 'incomplete_expired'];

export const isTerminalStripeStatus = ({ status }: { status: string }): boolean =>
  STRIPE_TERMINAL_STATUSES.includes(status);

export const FEATURES = {
  bank_providers: 'bank_providers',
  operator_ai: 'operator_ai',
  backup_export: 'backup_export',
  backup_restore: 'backup_restore',
  data_export: 'data_export',
  attachments: 'attachments',
  invoice_matching: 'invoice_matching',
  fire_planner: 'fire_planner',
  budget_plan: 'budget_plan',
  smart_tracking: 'smart_tracking',
  goals: 'goals',
} as const;
export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

/** Features a user without the entitlement may still run this many times, ever. */
export const FEATURE_TRIAL_LIMITS: Partial<Record<Feature, number>> = {
  [FEATURES.invoice_matching]: 5,
};
export const TRIALABLE_FEATURES = Object.keys(FEATURE_TRIAL_LIMITS) as Feature[];

/** Features a user without the entitlement may use for this many days from first open. */
export const FEATURE_TRIAL_DAYS = {
  [FEATURES.fire_planner]: 14,
  [FEATURES.smart_tracking]: 14,
  [FEATURES.goals]: 14,
} as const satisfies Partial<Record<Feature, number>>;
export type DayTrialableFeature = keyof typeof FEATURE_TRIAL_DAYS;
export const DAY_TRIALABLE_FEATURES = Object.keys(FEATURE_TRIAL_DAYS) as DayTrialableFeature[];

export interface FeatureTrial {
  startedAt: string;
  endsAt: string;
}

const ESSENTIAL_FEATURES: readonly Feature[] = [
  FEATURES.backup_export,
  FEATURES.backup_restore,
  FEATURES.data_export,
  FEATURES.attachments,
  FEATURES.budget_plan,
  FEATURES.goals,
];
const PLUS_FEATURES: readonly Feature[] = [
  ...ESSENTIAL_FEATURES,
  FEATURES.bank_providers,
  FEATURES.operator_ai,
  FEATURES.invoice_matching,
  FEATURES.fire_planner,
  FEATURES.smart_tracking,
];
/** Plus as of launch (2026-09-15), inlined: a feature added to ESSENTIAL_FEATURES later is paid for early adopters. */
const EARLY_ADOPTER_FEATURES: readonly Feature[] = [
  FEATURES.backup_export,
  FEATURES.backup_restore,
  FEATURES.data_export,
  FEATURES.attachments,
  FEATURES.bank_providers,
  FEATURES.operator_ai,
];

/**
 * Gates check `features.includes(x)`, never `plan === 'plus'`, so limiting
 * early adopters later is a one-line edit here.
 */
export const PLAN_FEATURES: Record<Plan, readonly Feature[]> = {
  essential: ESSENTIAL_FEATURES,
  plus: PLUS_FEATURES,
  early_adopter: EARLY_ADOPTER_FEATURES,
};

/**
 * Feature an AI feature needs to run on the server key. Unlisted ones need `operator_ai`; the user's own key always works.
 * Each one starts a day trial when the user turns it on, so it must be day-trialable.
 */
export const AI_FEATURE_ENTITLEMENTS = {
  [AI_FEATURE.trackerMatching]: FEATURES.smart_tracking,
} as const satisfies Partial<Record<AI_FEATURE, DayTrialableFeature>>;

export const getAiFeatureEntitlement = ({ feature }: { feature?: AI_FEATURE }): Feature =>
  (feature && (AI_FEATURE_ENTITLEMENTS as Partial<Record<AI_FEATURE, Feature>>)[feature]) ?? FEATURES.operator_ai;

export const hasServerAiEntitlement = ({
  entitlements,
  feature,
}: {
  entitlements: Pick<Entitlements, 'features'>;
  feature?: AI_FEATURE;
}): boolean => entitlements.features.includes(getAiFeatureEntitlement({ feature }));

export const SEATS_BY_PLAN: Record<Plan, number> = {
  essential: 2,
  plus: 5,
  early_adopter: 5,
};

/** Restore stays paid: restoring into a fresh trial account would renew the trial indefinitely. */
export const TRIAL_EXCLUDED_FEATURES: readonly Feature[] = [FEATURES.backup_restore];

export const TRIAL_DAYS = 40;

/** How long early adopters get `budget_plan`, counted from their first budget plan. */
export const EARLY_ADOPTER_BUDGET_TRIAL_DAYS = 40;

export interface ScheduledChange {
  action: 'cancel' | 'resume';
  effectiveAt: string;
}

export interface BillingSubscriptionSummary {
  externalSubscriptionId: string;
  tier: BillingTier;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  currentPeriodEndsAt: string;
  scheduledChange: ScheduledChange | null;
}

export interface Entitlements {
  features: readonly Feature[];
  readOnly: boolean;
  seats: number;
  /** Non-null means a lifetime grant of that plan. */
  plan: Plan | null;
  trialEndsAt: string | null;
  /** End of the early adopter budget trial, past or future, once a first plan started it. Null outside that trial. */
  budgetPlanTrialEndsAt: string | null;
  subscriptions: BillingSubscriptionSummary[];
  /** Tries already spent against `FEATURE_TRIAL_LIMITS`. Absent key means zero. */
  trialUsage: Partial<Record<Feature, number>>;
  /** Day-based feature trials that were started. Active ones are already merged into `features`. */
  featureTrials: Partial<Record<Feature, FeatureTrial>>;
}

/** Access continues while the status is entitled and the paid period has not elapsed. */
export const isEntitledSubscription = ({
  status,
  currentPeriodEndsAt,
  now = Date.now(),
}: {
  status: SubscriptionStatus;
  currentPeriodEndsAt: Date | string;
  now?: number;
}): boolean => ENTITLED_SUBSCRIPTION_STATUSES.includes(status) && new Date(currentPeriodEndsAt).getTime() > now;

/** Early adopters and trials hold Plus features without paying for Plus. */
export const hasPaidPlus = ({
  entitlements,
}: {
  entitlements: Pick<Entitlements, 'plan' | 'subscriptions'>;
}): boolean =>
  entitlements.plan === PLANS.plus ||
  entitlements.subscriptions.some((s) => s.tier === PLANS.plus && isEntitledSubscription(s));

export type StripeEnvironment = 'test' | 'live';

/**
 * Stripe price ids are per-mode: a `price_` minted in test mode does not resolve
 * in live mode. Checkout is opened with them, and the subscription webhook
 * reverse-maps them to a tier.
 */
export const STRIPE_PRICE_IDS: Record<StripeEnvironment, Record<BillingTier, Record<BillingCycle, string>>> = {
  test: {
    essential: {
      month: 'price_1UFEyOCr9EksbtoDs07fbGbC',
      year: 'price_1UFFVbCr9EksbtoD5iKVymgZ',
    },
    plus: {
      month: 'price_1UFFVcCr9EksbtoDQ5DGIZwT',
      year: 'price_1UFFVcCr9EksbtoD8Se3s8YZ',
    },
  },
  live: {
    essential: {
      month: 'price_1UFwoOCbCW2ZJsWzt8NATzaF',
      year: 'price_1UFwoOCbCW2ZJsWzaulBTaX7',
    },
    plus: {
      month: 'price_1UFwoKCbCW2ZJsWzW9eLs06J',
      year: 'price_1UFwoKCbCW2ZJsWzuJ2Slpz2',
    },
  },
};

export const resolveTierByPriceId = ({
  env,
  priceId,
}: {
  env: StripeEnvironment;
  priceId: string;
}): { tier: BillingTier; billingCycle: BillingCycle } | null => {
  if (!priceId) return null;
  for (const tier of BILLING_TIERS) {
    for (const billingCycle of Object.values(BILLING_CYCLES)) {
      if (STRIPE_PRICE_IDS[env][tier][billingCycle] === priceId) return { tier, billingCycle };
    }
  }
  return null;
};
