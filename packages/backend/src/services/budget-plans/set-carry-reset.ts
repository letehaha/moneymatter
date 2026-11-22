import { RecordId, SetBudgetPlanCarryResetPayload } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';
import { getPeriodView } from './get-period-view';
import { ensureCurrentPeriods } from './periods/ensure-periods';

interface SetCarryResetParams extends SetBudgetPlanCarryResetPayload {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
  timezone: string;
}

const setCarryResetImpl = async ({ userId, planId, periodId, reset, timezone }: SetCarryResetParams) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { periods } = await ensureCurrentPeriods({ plan });

  const period = periods.find((entry) => entry.id === periodId);
  if (!period) throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });

  await period.update({ carryReset: reset });

  return getPeriodView({ userId, planId, periodId, timezone });
};

export const setCarryReset = withTransaction(setCarryResetImpl);
