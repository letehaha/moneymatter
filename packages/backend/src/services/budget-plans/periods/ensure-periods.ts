import { toUtcDateString } from '@common/utils/date';
import { UnexpectedError } from '@js/errors';
import { logger } from '@js/utils/logger';
import BudgetLines from '@models/budget-lines.model';
import BudgetPeriods from '@models/budget-periods.model';
import BudgetPlans from '@models/budget-plans.model';

import { FUTURE_PERIODS, MAX_PLAN_PERIODS, boundaryAtOrBefore, nextBoundary } from './period-enumerator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const malformedPlanError = ({ plan, reason }: { plan: BudgetPlans; reason: string }) => {
  logger.error(`[Budget plans] ensurePeriods: ${reason}`, {
    planId: plan.id,
    cadence: plan.cadence,
    intervalN: plan.intervalN,
    anchorDate: plan.anchorDate,
    epochDate: plan.epochDate,
  });
  return new UnexpectedError({ message: `Budget plan ${plan.id}: ${reason}` });
};

export const loadPeriods = ({ planId }: { planId: BudgetPlans['id'] }) =>
  BudgetPeriods.findAll({ where: { planId }, order: [['startDate', 'ASC']] });

export const loadLines = ({ planId }: { planId: BudgetPlans['id'] }) =>
  BudgetLines.findAll({
    where: { planId },
    order: [
      ['sortOrder', 'ASC'],
      ['id', 'ASC'],
    ],
  });

/**
 * A read that inserts rows: stored periods run from the epoch through the one
 * covering `today` plus `FUTURE_PERIODS` more, so money can be assigned ahead.
 *
 * The re-SELECT is mandatory: ids are generated client-side, so the loser of a
 * race holds ids that `ignoreDuplicates` never inserted.
 */
export const ensurePeriods = async ({
  plan,
  today,
}: {
  plan: BudgetPlans;
  today: string;
}): Promise<BudgetPeriods[]> => {
  const lastStart = nextBoundary({ plan, after: today, steps: FUTURE_PERIODS });
  if (!ISO_DATE.test(lastStart)) {
    throw malformedPlanError({ plan, reason: `last future boundary is not a valid date (${lastStart})` });
  }
  const stored = await loadPeriods({ planId: plan.id });

  let lastEnd = toUtcDateString(stored.at(-1)?.endDate ?? plan.epochDate);
  const missing: { planId: BudgetPlans['id']; startDate: string; endDate: string }[] = [];

  // Past the JS Date range a boundary turns into NaN or a 5-digit year and stops advancing.
  while (lastEnd <= lastStart && stored.length + missing.length <= MAX_PLAN_PERIODS) {
    const endDate = nextBoundary({ plan, after: lastEnd });
    if (!ISO_DATE.test(endDate) || endDate <= lastEnd) {
      throw malformedPlanError({ plan, reason: `period boundary stopped advancing after ${lastEnd} (${endDate})` });
    }
    missing.push({ planId: plan.id, startDate: lastEnd, endDate });
    lastEnd = endDate;
  }
  if (stored.length + missing.length > MAX_PLAN_PERIODS) {
    throw malformedPlanError({ plan, reason: `period count exceeds ${MAX_PLAN_PERIODS}` });
  }

  if (!missing.length) return stored;

  await BudgetPeriods.bulkCreate(missing, { ignoreDuplicates: true });
  return loadPeriods({ planId: plan.id });
};

/**
 * What every write needs: the stored periods, the start of the one today falls
 * into, and the starts a line lifetime or membership change may begin on.
 */
export const ensureCurrentPeriods = async ({
  plan,
}: {
  plan: BudgetPlans;
}): Promise<{ periods: BudgetPeriods[]; startsThroughCurrent: string[]; currentStart: string }> => {
  const today = toUtcDateString(new Date());
  const periods = await ensurePeriods({ plan, today });
  const currentStart = boundaryAtOrBefore({ plan, date: today });
  const startsThroughCurrent = periods
    .map((period) => toUtcDateString(period.startDate))
    .filter((start) => start <= currentStart);

  return { periods, startsThroughCurrent, currentStart };
};
