import {
  DAY_TRIALABLE_FEATURES,
  EARLY_ADOPTER_BUDGET_TRIAL_DAYS,
  Entitlements,
  FEATURES,
  Feature,
  PLAN_FEATURES,
  PLANS,
  Plan,
  SEATS_BY_PLAN,
  TRIAL_EXCLUDED_FEATURES,
  TRIALABLE_FEATURES,
  USER_ROLES,
  isEntitledSubscription,
} from '@bt/shared/types';
import { isSelfHost } from '@config/is-self-host';
import { NotFoundError } from '@js/errors';
import { captureException } from '@js/utils/sentry';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import Users from '@models/users.model';
import { addDays } from 'date-fns';

import { getFeatureTrials, getTrialUsage, isFeatureTrialActive } from './feature-trial.service';

type EntitlementUser = Pick<Users, 'id' | 'role' | 'plan' | 'trialEndsAt' | 'firstBudgetPlanAt'>;

const ALL_FEATURES: readonly Feature[] = Object.values(FEATURES);
const SELF_HOST_SEATS = 10;
const TRIAL_FEATURES = PLAN_FEATURES.plus.filter((f) => !TRIAL_EXCLUDED_FEATURES.includes(f));
const DEMO_EXCLUDED_FEATURES: readonly Feature[] = [
  FEATURES.backup_export,
  FEATURES.backup_restore,
  FEATURES.data_export,
  FEATURES.attachments,
];
const DEMO_FEATURES = PLAN_FEATURES.plus.filter((f) => !DEMO_EXCLUDED_FEATURES.includes(f));
const READ_ONLY_FEATURES: readonly Feature[] = [FEATURES.data_export];

const toIso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** DB strings, so an unrecognised one is a data bug — reported, then treated as no plan. */
const lookupPlan = ({ key }: { key: string }): { features: readonly Feature[]; seats: number } | null => {
  const features = PLAN_FEATURES[key as Plan];
  if (!features) {
    captureException({ error: new Error(`Unknown billing plan or tier "${key}"`) });
    return null;
  }
  return { features, seats: SEATS_BY_PLAN[key as Plan] };
};

/**
 * Order: self-host → demo → plan grant ∪ active subscriptions (+ early adopter
 * budget trial) → trial → legacy (pre-trial user) → read-only.
 */
export async function resolveEntitlements({ user }: { user: EntitlementUser }): Promise<Entitlements> {
  const base = {
    plan: user.plan ?? null,
    trialEndsAt: toIso(user.trialEndsAt),
    budgetPlanTrialEndsAt: null as string | null,
    subscriptions: [] as Entitlements['subscriptions'],
  };
  const grant = async (features: readonly Feature[], seats: number): Promise<Entitlements> => {
    const holdsAll = ({ trialable }: { trialable: readonly Feature[] }) =>
      trialable.every((feature) => features.includes(feature));
    // Trials only exist for a feature the user is not entitled to, so someone holding
    // all of them never needs the rows read — and every write request resolves these.
    const [trialUsage, featureTrials] = await Promise.all([
      holdsAll({ trialable: TRIALABLE_FEATURES }) ? {} : getTrialUsage({ userId: user.id }),
      holdsAll({ trialable: DAY_TRIALABLE_FEATURES }) ? {} : getFeatureTrials({ userId: user.id }),
    ]);
    const activeTrials = DAY_TRIALABLE_FEATURES.filter(
      (feature) => !features.includes(feature) && isFeatureTrialActive({ featureTrials, feature }),
    );

    return {
      ...base,
      features: [...features, ...activeTrials],
      seats,
      readOnly: false,
      trialUsage,
      featureTrials,
    };
  };

  if (isSelfHost()) return grant(ALL_FEATURES, SELF_HOST_SEATS);

  if (user.role === USER_ROLES.demo) return grant(DEMO_FEATURES, SEATS_BY_PLAN.plus);

  const now = Date.now();
  const subscriptions = await BillingSubscriptions.findAll({
    where: { userId: user.id },
    order: [['createdAt', 'DESC']],
  });
  base.subscriptions = subscriptions.map((s) => ({
    provider: s.provider,
    externalSubscriptionId: s.externalSubscriptionId,
    tier: s.tier,
    status: s.status,
    billingCycle: s.billingCycle,
    currentPeriodEndsAt: s.currentPeriodEndsAt.toISOString(),
    scheduledChange: s.scheduledChange,
  }));

  const entitled = subscriptions.filter((s) =>
    isEntitledSubscription({ status: s.status, currentPeriodEndsAt: s.currentPeriodEndsAt, now }),
  );
  const features = new Set<Feature>();
  let seats = 0;
  const own = ({ key }: { key: string }) => {
    const owned = lookupPlan({ key });
    if (!owned) return;
    owned.features.forEach((f) => features.add(f));
    seats = Math.max(seats, owned.seats);
  };
  // A granted plan and a paid subscription are separate facts; the user holds the union.
  if (user.plan) own({ key: user.plan });
  for (const s of entitled) own({ key: s.tier });

  // Budgeting stays open until a first plan starts the countdown.
  if (user.plan === PLANS.early_adopter && !features.has(FEATURES.budget_plan)) {
    const endsAt = user.firstBudgetPlanAt
      ? addDays(new Date(user.firstBudgetPlanAt), EARLY_ADOPTER_BUDGET_TRIAL_DAYS)
      : null;
    base.budgetPlanTrialEndsAt = toIso(endsAt);
    if (!endsAt || endsAt.getTime() > now) features.add(FEATURES.budget_plan);
  }
  if (features.size) return grant([...features], seats);

  if (user.trialEndsAt && new Date(user.trialEndsAt).getTime() > now) return grant(TRIAL_FEATURES, SEATS_BY_PLAN.plus);

  // Dark launch: users created before trials existed carry no trial and never
  // subscribed. They keep everything until the grandfather script assigns a plan.
  if (!user.trialEndsAt && subscriptions.length === 0) return grant(PLAN_FEATURES[PLANS.plus], SEATS_BY_PLAN.plus);

  // Read-only still grants data_export: a lapsed user must be able to take their
  // data out. A free try is unreachable for them — `enforceReadOnly` 402s the write first.
  return {
    ...base,
    features: READ_ONLY_FEATURES,
    seats: SEATS_BY_PLAN.essential,
    readOnly: true,
    trialUsage: {},
    featureTrials: {},
  };
}

export async function getEntitlementsByUserId({ userId }: { userId: number }): Promise<Entitlements> {
  const user = await Users.findByPk(userId, {
    attributes: ['id', 'role', 'plan', 'trialEndsAt', 'firstBudgetPlanAt'],
  });
  if (!user) throw new NotFoundError({ message: 'User not found.' });
  return resolveEntitlements({ user });
}
