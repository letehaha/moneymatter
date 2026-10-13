import { RecordId } from '@bt/shared/types';
import { BudgetLineGoal, SetBudgetLineGoalPayload } from '@bt/shared/types';
import { Money, centsToApiDecimal, centsToApiDecimalOrNull } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import BudgetLineGoals from '@models/budget-line-goals.model';
import BudgetPeriods from '@models/budget-periods.model';
import { withTransaction } from '@services/common/with-transaction';

import { findLine, findPlan } from './find-plan';
import { GoalSpec } from './fold/goal-ask';
import { currentPeriodStart } from './periods/period-enumerator';

interface LineGoalParams {
  userId: number;
  planId: RecordId;
  lineId: RecordId;
}

const dateOrNull = ({ value }: { value: string | null }): string | null => (value ? toUtcDateString(value) : null);

export const toGoalSpec = ({ row }: { row: BudgetLineGoals }): GoalSpec & { lineId: RecordId } => ({
  lineId: row.lineId,
  frequency: row.frequency,
  behavior: row.behavior,
  amount: row.amount.toCents(),
  weekday: row.weekday,
  anchorDate: dateOrNull({ value: row.anchorDate }),
  repeatEvery: row.repeatEvery,
  repeatUnit: row.repeatUnit,
  stopAtBalance: row.stopAtBalance?.toCents() ?? null,
  fundingCap: row.fundingCap?.toCents() ?? null,
  startPeriodStart: toUtcDateString(row.startPeriodStart),
  snoozedPeriodStart: dateOrNull({ value: row.snoozedPeriodStart }),
});

export const goalSpecToApi = ({ goal }: { goal: GoalSpec & { lineId: RecordId } }): BudgetLineGoal => ({
  ...goal,
  amount: centsToApiDecimal(goal.amount),
  stopAtBalance: centsToApiDecimalOrNull(goal.stopAtBalance),
  fundingCap: centsToApiDecimalOrNull(goal.fundingCap),
});

const toGoal = ({ row }: { row: BudgetLineGoals }): BudgetLineGoal => goalSpecToApi({ goal: toGoalSpec({ row }) });

const findPeriod = ({ planId, periodId }: { planId: RecordId; periodId: RecordId }) =>
  findOrThrowNotFound({
    query: BudgetPeriods.findOne({ where: { id: periodId, planId } }),
    message: t({ key: 'budgetPlans.periodNotFound' }),
  });

const findGoal = async ({ userId, planId, lineId }: LineGoalParams) => {
  const plan = await findPlan({ planId, userId, lock: true });
  await findLine({ planId: plan.id, lineId });
  return findOrThrowNotFound({
    query: BudgetLineGoals.findOne({ where: { lineId } }),
    message: t({ key: 'budgetPlans.goalNotFound' }),
  });
};

const setLineGoalImpl = async ({
  userId,
  planId,
  lineId,
  periodId,
  amount,
  stopAtBalance,
  fundingCap,
  ...settings
}: LineGoalParams & Omit<SetBudgetLineGoalPayload, 'periodId'> & { periodId?: RecordId }): Promise<BudgetLineGoal> => {
  const plan = await findPlan({ planId, userId, lock: true });
  await findLine({ planId: plan.id, lineId });

  const values = {
    frequency: settings.frequency,
    behavior: settings.behavior,
    amount: Money.fromDecimal(amount),
    weekday: settings.weekday ?? null,
    anchorDate: settings.anchorDate ?? null,
    repeatEvery: settings.repeatEvery ?? null,
    repeatUnit: settings.repeatUnit ?? null,
    stopAtBalance: stopAtBalance == null ? null : Money.fromDecimal(stopAtBalance),
    fundingCap: fundingCap == null ? null : Money.fromDecimal(fundingCap),
    ...(settings.frequency === 'open_ended' && { snoozedPeriodStart: null }),
  };
  const existing = await BudgetLineGoals.findOne({ where: { lineId } });
  if (existing) return toGoal({ row: await existing.update(values) });

  const startPeriodStart = periodId
    ? toUtcDateString((await findPeriod({ planId: plan.id, periodId })).startDate)
    : currentPeriodStart({ plan });
  const row = await BudgetLineGoals.create({ lineId, ...values, startPeriodStart });

  return toGoal({ row });
};

const deleteLineGoalImpl = async (params: LineGoalParams): Promise<void> => {
  const goal = await findGoal(params);
  await goal.destroy();
};

/** Snoozing the already-snoozed period wakes the goal up again. */
const snoozeLineGoalImpl = async ({ periodId, ...params }: LineGoalParams & { periodId: RecordId }) => {
  const goal = await findGoal(params);
  if (goal.frequency === 'open_ended') {
    throw new ValidationError({ message: t({ key: 'budgetPlans.openEndedGoalCannotSnooze' }) });
  }
  const period = await findPeriod({ planId: params.planId, periodId });

  const start = toUtcDateString(period.startDate);
  const current = dateOrNull({ value: goal.snoozedPeriodStart });
  await goal.update({ snoozedPeriodStart: current === start ? null : start });

  return toGoal({ row: goal });
};

export const setLineGoal = withTransaction(setLineGoalImpl);
export const deleteLineGoal = withTransaction(deleteLineGoalImpl);
export const snoozeLineGoal = withTransaction(snoozeLineGoalImpl);
