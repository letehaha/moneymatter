import { RecordId } from '@bt/shared/types';
import { SetBudgetPlanAssignmentPayload } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import { withTransaction } from '@services/common/with-transaction';

import { covers, toRange } from './date-ranges';
import { findLine, findPlan } from './find-plan';
import { isEmptyAssignment } from './fold/resolve-assigned';
import { getPeriodView } from './get-period-view';
import { ensureCurrentPeriods } from './periods/ensure-periods';

/** `scope` only affects `amount`: a baseline runs on, an override is one period. */
interface SetAssignmentParams extends SetBudgetPlanAssignmentPayload {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
  lineId: RecordId;
}

const setAssignmentImpl = async ({
  userId,
  planId,
  periodId,
  lineId,
  scope,
  amount,
  carryPolicy,
}: SetAssignmentParams) => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { periods } = await ensureCurrentPeriods({ plan });

  const period = periods.find((entry) => entry.id === periodId);
  if (!period) throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });

  const line = await findLine({ planId: plan.id, lineId });
  const lifetime = toRange({ from: line.activeFrom, until: line.activeUntil });
  if (!covers({ range: lifetime, start: toUtcDateString(period.startDate) })) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.periodOutsideLifetime' }) });
  }

  const existing = await BudgetAssignments.findOne({ where: { periodId, lineId } });

  const next = {
    baselineAmount: existing?.baselineAmount ?? null,
    overrideAmount: existing?.overrideAmount ?? null,
    carryPolicy: existing?.carryPolicy ?? null,
  };

  if (amount !== undefined) {
    if (amount === null) {
      next[scope === 'from_here' ? 'baselineAmount' : 'overrideAmount'] = null;
    } else if (scope === 'from_here') {
      next.baselineAmount = Money.fromDecimal(amount);
      next.overrideAmount = null;
    } else {
      next.overrideAmount = Money.fromDecimal(amount);
    }
  }

  if (carryPolicy !== undefined) next.carryPolicy = carryPolicy;

  // The row CHECK is not deferrable, so the final state decides between a
  // delete and an upsert; "upsert, then delete" would fail.
  const empty = isEmptyAssignment(next);

  if (existing && empty) await existing.destroy();
  else if (existing) await existing.update(next);
  else if (!empty) await BudgetAssignments.create({ periodId, lineId, ...next });

  return getPeriodView({ userId, planId, periodId });
};

export const setAssignment = withTransaction(setAssignmentImpl);
