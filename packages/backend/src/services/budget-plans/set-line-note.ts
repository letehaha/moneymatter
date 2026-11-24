import { RecordId, SetBudgetPlanNotePayload } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError } from '@js/errors';
import BudgetLineNotes from '@models/budget-line-notes.model';
import { withTransaction } from '@services/common/with-transaction';

import { covers, toRange } from './date-ranges';
import { findLine, findPlan } from './find-plan';
import { getPeriodView } from './get-period-view';
import { ensureCurrentPeriods } from './periods/ensure-periods';

interface SetLineNoteParams extends SetBudgetPlanNotePayload {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
  lineId: RecordId;
  timezone: string;
}

const setLineNoteImpl = async ({ userId, planId, periodId, lineId, note, timezone }: SetLineNoteParams) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { periods } = await ensureCurrentPeriods({ plan });

  const period = periods.find((entry) => entry.id === periodId);
  if (!period) throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });

  const line = await findLine({ planId, lineId });
  const lifetime = toRange({ from: line.activeFrom, until: line.activeUntil });
  if (!covers({ range: lifetime, start: toUtcDateString(period.startDate) })) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.periodOutsideLifetime' }) });
  }

  if (!note) await BudgetLineNotes.destroy({ where: { periodId, lineId } });
  else await BudgetLineNotes.upsert({ periodId, lineId, note });

  return getPeriodView({ userId, planId, periodId, timezone });
};

export const setLineNote = withTransaction(setLineNoteImpl);
