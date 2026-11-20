import { RecordId } from '@bt/shared/types';
import { BudgetPlanTrends } from '@bt/shared/types';
import { minorUnitsToApiDecimal } from '@common/types/money';
import { toZonedDateString } from '@common/utils/date';
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
  timezone,
}: {
  userId: number;
  planId: RecordId;
  until?: RecordId;
  count: number;
  timezone: string;
}): Promise<BudgetPlanTrends> => {
  const plan = await findPlan({ planId, userId });

  const today = toZonedDateString({ date: new Date(), timezone });
  const foldInput = await loadFoldInput({ plan, today, timezone });
  const { decimals } = foldInput;
  const views = foldPlan(foldInput);

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
      assigned: minorUnitsToApiDecimal({ value: header.totalAssigned, decimals }),
      activity: minorUnitsToApiDecimal({ value: header.totalActivity, decimals }),
      carriedIn: minorUnitsToApiDecimal({ value: header.totalCarriedIn, decimals }),
      available: minorUnitsToApiDecimal({ value: header.totalAvailable, decimals }),
      lines: lines.map((line) => ({
        lineId: line.lineId,
        assigned: minorUnitsToApiDecimal({ value: line.assigned, decimals }),
        activity: minorUnitsToApiDecimal({ value: line.activity, decimals }),
        available: minorUnitsToApiDecimal({ value: line.available, decimals }),
      })),
    })),
  };
};
