import { toUtcDateString } from '@common/utils/date';
import BudgetPeriods from '@models/budget-periods.model';
import BudgetPlans from '@models/budget-plans.model';

import { nextBoundary } from './period-enumerator';

export const loadPeriods = ({ planId }: { planId: BudgetPlans['id'] }) =>
  BudgetPeriods.findAll({ where: { planId }, order: [['startDate', 'ASC']] });

/**
 * A read that inserts rows: stored periods from the epoch up to and including
 * the one that starts on `upTo` are the single source of truth. `endDate` is
 * exclusive, so a request on a boundary day creates the period starting it.
 *
 * The re-SELECT is mandatory: ids are generated client-side, so the loser of a
 * race holds ids that `ignoreDuplicates` never inserted.
 */
export const ensurePeriods = async ({ plan, upTo }: { plan: BudgetPlans; upTo: string }): Promise<BudgetPeriods[]> => {
  const stored = await loadPeriods({ planId: plan.id });

  let lastEnd = toUtcDateString(stored.at(-1)?.endDate ?? plan.epochDate);
  const missing: { planId: BudgetPlans['id']; startDate: string; endDate: string }[] = [];

  while (lastEnd <= upTo) {
    const endDate = nextBoundary({ plan, after: lastEnd });
    missing.push({ planId: plan.id, startDate: lastEnd, endDate });
    lastEnd = endDate;
  }

  if (!missing.length) return stored;

  await BudgetPeriods.bulkCreate(missing, { ignoreDuplicates: true });
  return loadPeriods({ planId: plan.id });
};

/** What every write needs: the stored periods and the one today falls into. */
export const ensureCurrentPeriods = async ({
  plan,
}: {
  plan: BudgetPlans;
}): Promise<{ periods: BudgetPeriods[]; starts: string[]; currentStart: string }> => {
  const periods = await ensurePeriods({ plan, upTo: toUtcDateString(new Date()) });
  const starts = periods.map((period) => toUtcDateString(period.startDate));

  return { periods, starts, currentStart: starts.at(-1)! };
};
