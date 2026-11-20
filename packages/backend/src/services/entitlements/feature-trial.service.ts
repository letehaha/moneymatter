import {
  DAY_TRIALABLE_FEATURES,
  type DayTrialableFeature,
  type Entitlements,
  FEATURE_TRIAL_DAYS,
  FEATURE_TRIAL_LIMITS,
  type Feature,
  type FeatureTrial,
  TRIALABLE_FEATURES,
} from '@bt/shared/types';
import FeatureUsages from '@models/feature-usages.model';
import { Op, QueryTypes } from 'sequelize';

export type FeatureAccess = 'plan' | 'trial' | 'denied';

export const FEATURE_NOT_IN_PLAN_MESSAGE = 'This feature is not included in your current plan.';

export const hasFeature = ({
  entitlements,
  feature,
}: {
  entitlements: Pick<Entitlements, 'features'>;
  feature: Feature;
}) => entitlements.features.includes(feature);

export const getTrialUsage = async ({ userId }: { userId: number }): Promise<Partial<Record<Feature, number>>> => {
  const rows = await FeatureUsages.findAll({
    where: { userId, feature: { [Op.in]: TRIALABLE_FEATURES } },
    attributes: ['feature', 'usedCount'],
  });

  return Object.fromEntries(rows.map((row) => [row.feature, row.usedCount]));
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const getFeatureTrials = async ({
  userId,
}: {
  userId: number;
}): Promise<Partial<Record<Feature, FeatureTrial>>> => {
  const rows = await FeatureUsages.findAll({
    where: { userId, feature: { [Op.in]: DAY_TRIALABLE_FEATURES }, trialStartedAt: { [Op.ne]: null } },
    attributes: ['feature', 'trialStartedAt'],
  });

  return Object.fromEntries(
    rows.map(({ feature, trialStartedAt }) => {
      const startedAt = trialStartedAt!;
      return [
        feature,
        {
          startedAt: startedAt.toISOString(),
          endsAt: new Date(
            startedAt.getTime() + FEATURE_TRIAL_DAYS[feature as DayTrialableFeature] * DAY_MS,
          ).toISOString(),
        },
      ];
    }),
  );
};

export const isFeatureTrialActive = ({
  featureTrials,
  feature,
}: {
  featureTrials: Entitlements['featureTrials'];
  feature: Feature;
}): boolean => {
  const trial = featureTrials[feature];
  return !!trial && new Date(trial.endsAt).getTime() > Date.now();
};

/**
 * `plan` when the entitlement covers the feature, `trial` while free tries remain,
 * `denied` otherwise. Reads nothing: the resolved entitlements already carry both
 * the granted features and the spent tries.
 */
export function getFeatureAccess({
  entitlements,
  feature,
}: {
  entitlements: Entitlements;
  feature: Feature;
}): FeatureAccess {
  if (hasFeature({ entitlements, feature })) return 'plan';

  const limit = FEATURE_TRIAL_LIMITS[feature];
  if (!limit) return 'denied';

  return (entitlements.trialUsage[feature] ?? 0) < limit ? 'trial' : 'denied';
}

/**
 * ponytail: the gate reads the count and this writes it in a separate statement, so N requests
 * arriving on the same count all pass and overshoot the limit by N-1, capped by the 30/min
 * upload rate limit. Upgrade path: fold the check into this statement with
 * `WHERE "usedCount" < :limit RETURNING "usedCount"` and 402 on no row.
 */
export const recordFeatureUse = async ({ userId, feature }: { userId: number; feature: Feature }): Promise<void> => {
  await FeatureUsages.sequelize!.query(
    `INSERT INTO "FeatureUsages" ("userId", "feature", "usedCount", "createdAt", "updatedAt")
     VALUES (:userId, :feature, 1, NOW(), NOW())
     ON CONFLICT ("userId", "feature")
     DO UPDATE SET "usedCount" = "FeatureUsages"."usedCount" + 1, "updatedAt" = NOW()`,
    { replacements: { userId, feature }, type: QueryTypes.INSERT },
  );
};
