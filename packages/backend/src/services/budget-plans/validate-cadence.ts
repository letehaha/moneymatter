import { BUDGET_PLAN_CADENCES, BUDGET_PLAN_CARRY_POLICIES, BudgetPlanCadence } from '@bt/shared/types/budget-plans';
import { dateBound } from '@common/lib/zod/custom-types';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';

import {
  FUTURE_PERIODS,
  MAX_PLAN_PERIODS,
  PeriodCadenceConfig,
  anchorParts,
  countPeriodsBetween,
  validateSemiMonthlyDays,
} from './periods/period-enumerator';

const MAX_INTERVAL_N: Record<BudgetPlanCadence, number> = { days: 366, months: 12, semi_monthly: 1 };

/** "Last day of the month" is `anchorDate.day = 31`; the enumerator clamps it. */
export const validateCadence = ({ cadence, intervalN, anchorDate, secondAnchorDay }: PeriodCadenceConfig): void => {
  if (intervalN > MAX_INTERVAL_N[cadence]) {
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

const isDate = ({ value }: { value: unknown }) => dateBound().safeParse(value).success;

/** Restore skips createPlan, so a stored row gets its cadence rules and an epoch bound here. */
export const isRestorablePlanRow = ({ row }: { row: Record<string, unknown> }): boolean => {
  const plan = row as unknown as PeriodCadenceConfig & {
    epochDate: string;
    carryPolicy: string;
    zeroSum?: boolean;
    poolFrom?: string | null;
  };
  if (!BUDGET_PLAN_CADENCES.includes(plan.cadence)) return false;
  if (!(BUDGET_PLAN_CARRY_POLICIES as readonly string[]).includes(plan.carryPolicy)) return false;
  if (!Number.isInteger(plan.intervalN) || plan.intervalN < 1) return false;
  if (plan.secondAnchorDay !== null && !(plan.secondAnchorDay >= 1 && plan.secondAnchorDay <= 31)) return false;
  if (!isDate({ value: plan.anchorDate }) || !isDate({ value: plan.epochDate })) return false;
  // A row the zeroSum CHECK would reject aborts the whole restore transaction, so it is dropped here instead.
  if (plan.zeroSum && !plan.poolFrom) return false;

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
