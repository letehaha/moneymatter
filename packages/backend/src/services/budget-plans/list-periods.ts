import { RecordId } from '@bt/shared/types';
import { BudgetPlanPeriod } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';

import { findPlan } from './find-plan';
import { toPlanPeriod } from './fold/fold-plan';
import { ensurePeriods } from './periods/ensure-periods';

export const listPeriods = async ({
  userId,
  planId,
}: {
  userId: number;
  planId: RecordId;
}): Promise<BudgetPlanPeriod[]> => {
  const plan = await findPlan({ planId, userId });

  const today = toUtcDateString(new Date());
  const periods = await ensurePeriods({ plan, today });

  return periods.map((period) => toPlanPeriod({ period, today }));
};
