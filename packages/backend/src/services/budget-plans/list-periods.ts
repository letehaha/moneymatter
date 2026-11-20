import { RecordId } from '@bt/shared/types';
import { BudgetPlanPeriod } from '@bt/shared/types';
import { toZonedDateString } from '@common/utils/date';

import { findPlan } from './find-plan';
import { toPlanPeriod } from './fold/fold-plan';
import { ensurePeriods } from './periods/ensure-periods';

export const listPeriods = async ({
  userId,
  planId,
  timezone,
}: {
  userId: number;
  planId: RecordId;
  timezone: string;
}): Promise<BudgetPlanPeriod[]> => {
  const plan = await findPlan({ planId, userId });

  const today = toZonedDateString({ date: new Date(), timezone });
  const periods = await ensurePeriods({ plan, today });

  return periods.map((period) => toPlanPeriod({ period, today }));
};
