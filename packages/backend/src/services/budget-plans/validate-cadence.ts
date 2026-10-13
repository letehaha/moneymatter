import { BUDGET_PLAN_CADENCES, BUDGET_PLAN_CARRY_POLICIES, BUDGET_PLAN_MAX_INTERVAL_N } from '@bt/shared/types';
import { dateBound } from '@common/lib/zod/custom-types';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { z } from 'zod';

import {
  FUTURE_PERIODS,
  MAX_PLAN_PERIODS,
  PeriodCadenceConfig,
  anchorParts,
  countPeriodsBetween,
  validateSemiMonthlyDays,
} from './periods/period-enumerator';

/** "Last day of the month" is `anchorDate.day = 31`; the enumerator clamps it. */
export const validateCadence = ({ cadence, intervalN, anchorDate, secondAnchorDay }: PeriodCadenceConfig): void => {
  if (intervalN > BUDGET_PLAN_MAX_INTERVAL_N[cadence]) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.intervalOutOfRange' }) });
  }

  if (cadence !== 'semi_monthly') {
    if (secondAnchorDay !== null) {
      throw new ValidationError({ message: t({ key: 'budgetPlans.secondAnchorDayNotAllowed' }) });
    }
    return;
  }

  if (secondAnchorDay === null) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.secondAnchorDayRequired' }) });
  }
  const anchorDay = anchorParts({ plan: { anchorDate } }).day;
  if (!validateSemiMonthlyDays({ anchorDay, secondAnchorDay })) {
    throw new ValidationError({ message: t({ key: 'budgetPlans.semiMonthlyDaysTooClose' }) });
  }
};

const restorablePlanRow = z
  .object({
    cadence: z.enum(BUDGET_PLAN_CADENCES),
    carryPolicy: z.enum(BUDGET_PLAN_CARRY_POLICIES),
    intervalN: z.number().int().min(1),
    anchorDate: dateBound(),
    secondAnchorDay: z.number().int().min(1).max(31).nullable(),
    epochDate: dateBound(),
    zeroSum: z.boolean().nullish(),
    poolFrom: z.string().nullish(),
  })
  // A row the zeroSum CHECK would reject aborts the whole restore transaction, so it is dropped here instead.
  .refine((plan) => !plan.zeroSum || !!plan.poolFrom);

/** Restore skips createPlan, so a stored row gets its cadence rules and an epoch bound here. */
export const isRestorablePlanRow = ({ row }: { row: Record<string, unknown> }): boolean => {
  const parsed = restorablePlanRow.safeParse(row);
  if (!parsed.success) return false;
  const plan = parsed.data;

  try {
    validateCadence(plan);
  } catch (e) {
    if (!(e instanceof ValidationError)) throw e;
    return false;
  }
  // Leaves room for the periods ensurePeriods creates ahead of today, which count toward the same ceiling.
  const periodsToToday = countPeriodsBetween({ plan, from: plan.epochDate, to: toUtcDateString(new Date()) });
  return periodsToToday + FUTURE_PERIODS + 1 <= MAX_PLAN_PERIODS;
};
