import { RecordId } from '@bt/shared/types';
import { BudgetPlanTrends } from '@bt/shared/types';
import { centsToApiDecimal } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';

import { findPlan } from './find-plan';
import { foldPlan } from './fold/fold-plan';
import { loadFoldInput } from './get-period-view';

/** `count` periods ending at `until` (default: the current one), from the same fold the period view reads. */
export const getTrends = async ({
  userId,
  planId,
  until,
  count,
}: {
  userId: number;
  planId: RecordId;
  until?: RecordId;
  count: number;
}): Promise<BudgetPlanTrends> => {
  const plan = await findPlan({ planId, userId });

  const today = toUtcDateString(new Date());
  const views = foldPlan(await loadFoldInput({ plan, today }));

  const last = until
    ? views.findIndex((view) => view.period.id === until)
    : views.findLastIndex((view) => view.period.startDate <= today);
  if (until && last === -1) {
    throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });
  }

  return {
    periods: views.slice(Math.max(0, last - count + 1), last + 1).map(({ period, header, lines }) => ({
      periodId: period.id,
      startDate: period.startDate,
      endDate: period.endDate,
      assigned: centsToApiDecimal(header.totalAssigned),
      activity: centsToApiDecimal(header.totalActivity),
      carriedIn: centsToApiDecimal(header.totalCarriedIn),
      available: centsToApiDecimal(header.totalAvailable),
      lines: lines.map((line) => ({
        lineId: line.lineId,
        assigned: centsToApiDecimal(line.assigned),
        activity: centsToApiDecimal(line.activity),
        available: centsToApiDecimal(line.available),
      })),
    })),
  };
};
