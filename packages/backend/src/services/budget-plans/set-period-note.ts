import { RecordId, SetBudgetPlanNotePayload } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { withTransaction } from '@services/common/with-transaction';

import { findPlan } from './find-plan';
import { getPeriodView } from './get-period-view';
import { ensureCurrentPeriods } from './periods/ensure-periods';

interface SetPeriodNoteParams extends SetBudgetPlanNotePayload {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
  timezone: string;
}

const setPeriodNoteImpl = async ({ userId, planId, periodId, note, timezone }: SetPeriodNoteParams) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { periods } = await ensureCurrentPeriods({ plan });

  const period = periods.find((entry) => entry.id === periodId);
  if (!period) throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });

  await period.update({ note: note || null });

  return getPeriodView({ userId, planId, periodId, timezone });
};

export const setPeriodNote = withTransaction(setPeriodNoteImpl);
