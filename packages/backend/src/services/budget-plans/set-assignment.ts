import { RecordId } from '@bt/shared/types';
import { BudgetPlanCarryPolicy } from '@bt/shared/types/budget-plans';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLines from '@models/budget-lines.model';
import { withTransaction } from '@services/common/with-transaction';

import { getPeriodView } from './get-period-view';
import { lockPlan } from './lock-plan';
import { ensureCurrentPeriods } from './periods/ensure-periods';

interface SetAssignmentParams {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
  lineId: RecordId;
  /** Only `amount` reads it: a baseline runs on, an override is one period. */
  scope: 'from_here' | 'this_period';
  /** Decimal. `undefined` leaves the column untouched, `null` clears it. */
  amount?: number | null;
  carryPolicy?: BudgetPlanCarryPolicy | null;
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
  const plan = await lockPlan({ planId, userId });
  const { periods } = await ensureCurrentPeriods({ plan });

  const period = periods.find((entry) => entry.id === periodId);
  if (!period) throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });

  const line = await findOrThrowNotFound({
    query: BudgetLines.findOne({ where: { id: lineId, planId: plan.id } }),
    message: t({ key: 'budgetPlans.lineNotFound' }),
  });

  const start = toUtcDateString(period.startDate);
  const activeUntil = line.activeUntil === null ? null : toUtcDateString(line.activeUntil);
  if (start < toUtcDateString(line.activeFrom) || (activeUntil !== null && start >= activeUntil)) {
    throw new ConflictError({ message: t({ key: 'budgetPlans.periodOutsideLifetime' }) });
  }

  const existing = await BudgetAssignments.findOne({ where: { periodId, lineId } });

  const next = {
    baselineAmount: existing?.baselineAmount ?? null,
    overrideAmount: existing?.overrideAmount ?? null,
    carryPolicy: existing?.carryPolicy ?? null,
  };
  const touched: (keyof typeof next)[] = [];

  if (amount !== undefined) {
    if (amount === null) {
      const column = scope === 'from_here' ? 'baselineAmount' : 'overrideAmount';
      next[column] = null;
      touched.push(column);
    } else if (scope === 'from_here') {
      next.baselineAmount = Money.fromDecimal(amount);
      next.overrideAmount = null;
      touched.push('baselineAmount', 'overrideAmount');
    } else {
      next.overrideAmount = Money.fromDecimal(amount);
      touched.push('overrideAmount');
    }
  }

  if (carryPolicy !== undefined) {
    next.carryPolicy = carryPolicy;
    touched.push('carryPolicy');
  }

  // The row CHECK is not deferrable, so the final state decides between a
  // delete and an upsert; "upsert, then delete" would fail.
  const empty = next.baselineAmount === null && next.overrideAmount === null && next.carryPolicy === null;

  if (existing && empty) await existing.destroy();
  else if (existing) await existing.update(next, { fields: touched });
  else if (!empty) await BudgetAssignments.create({ periodId, lineId, ...next });

  return getPeriodView({ userId, planId, periodId });
};

export const setAssignment = withTransaction(setAssignmentImpl);
