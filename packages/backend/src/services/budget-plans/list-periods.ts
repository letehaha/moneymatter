import { RecordId } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import BudgetPlans from '@models/budget-plans.model';

import { ensurePeriods } from './periods/ensure-periods';

export const listPeriods = async ({ userId, planId }: { userId: number; planId: RecordId }) => {
  const plan = await findOrThrowNotFound({
    query: BudgetPlans.findOne({ where: { id: planId, userId } }),
    message: t({ key: 'budgetPlans.planNotFound' }),
  });

  const today = toUtcDateString(new Date());
  const periods = await ensurePeriods({ plan, upTo: today });

  return periods.map((period) => {
    const startDate = toUtcDateString(period.startDate);
    const endDate = toUtcDateString(period.endDate);
    return { id: period.id, startDate, endDate, isCurrent: startDate <= today && today < endDate };
  });
};
