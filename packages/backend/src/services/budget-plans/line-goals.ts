import { RecordId } from '@bt/shared/types';
import { BudgetLineGoal, SetBudgetLineGoalPayload } from '@bt/shared/types';
import { assertMoneyFitsCurrency, getCurrencyDecimals } from '@common/lib/currency-precision';
import { Money, minorUnitsToApiDecimal, minorUnitsToApiDecimalOrNull } from '@common/types/money';
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

/** Amounts in integer minor units at `decimals`, the plan currency's. */
export const toGoalSpec = ({
  row,
  decimals,
}: {
  row: BudgetLineGoals;
  decimals: number;
}): GoalSpec & { lineId: RecordId } => ({
  lineId: row.lineId,
  frequency: row.frequency,
  behavior: row.behavior,
  amount: row.amount.toMinorUnits({ decimals }),
  weekday: row.weekday,
  anchorDate: dateOrNull({ value: row.anchorDate }),
  repeatEvery: row.repeatEvery,
  repeatUnit: row.repeatUnit,
  stopAtBalance: row.stopAtBalance?.toMinorUnits({ decimals }) ?? null,
  fundingCap: row.fundingCap?.toMinorUnits({ decimals }) ?? null,
  startPeriodStart: toUtcDateString(row.startPeriodStart),
  snoozedPeriodStart: dateOrNull({ value: row.snoozedPeriodStart }),
});

export const goalSpecToApi = ({
  goal,
  decimals,
}: {
  goal: GoalSpec & { lineId: RecordId };
  decimals: number;
}): BudgetLineGoal => ({
  ...goal,
  amount: minorUnitsToApiDecimal({ value: goal.amount, decimals }),
  stopAtBalance: minorUnitsToApiDecimalOrNull({ value: goal.stopAtBalance, decimals }),
  fundingCap: minorUnitsToApiDecimalOrNull({ value: goal.fundingCap, decimals }),
});

const toGoal = ({ row, decimals }: { row: BudgetLineGoals; decimals: number }): BudgetLineGoal =>
  goalSpecToApi({ goal: toGoalSpec({ row, decimals }), decimals });

const findPeriod = ({ planId, periodId }: { planId: RecordId; periodId: RecordId }) =>
  findOrThrowNotFound({
    query: BudgetPeriods.findOne({ where: { id: periodId, planId } }),
    message: t({ key: 'budgetPlans.periodNotFound' }),
  });

const findGoal = async ({ userId, planId, lineId }: LineGoalParams) => {
  const plan = await findPlan({ planId, userId, lock: true });
  await findLine({ planId: plan.id, lineId });
  const goal = await findOrThrowNotFound({
    query: BudgetLineGoals.findOne({ where: { lineId } }),
    message: t({ key: 'budgetPlans.goalNotFound' }),
  });
  return { goal, plan };
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

  for (const value of [amount, stopAtBalance, fundingCap]) {
    if (value != null) {
      await assertMoneyFitsCurrency({ money: Money.fromDecimal(value), userId, currencyCode: plan.currencyCode });
    }
  }

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
  const decimals = await getCurrencyDecimals({ userId, code: plan.currencyCode });
  const existing = await BudgetLineGoals.findOne({ where: { lineId } });
  if (existing) return toGoal({ row: await existing.update(values), decimals });

  const startPeriodStart = periodId
    ? toUtcDateString((await findPeriod({ planId: plan.id, periodId })).startDate)
    : currentPeriodStart({ plan });
  const row = await BudgetLineGoals.create({ lineId, ...values, startPeriodStart });

  return toGoal({ row, decimals });
};

const deleteLineGoalImpl = async (params: LineGoalParams): Promise<void> => {
  const { goal } = await findGoal(params);
  await goal.destroy();
};

/** Snoozing the already-snoozed period wakes the goal up again. */
const snoozeLineGoalImpl = async ({ periodId, ...params }: LineGoalParams & { periodId: RecordId }) => {
  const { goal, plan } = await findGoal(params);
  if (goal.frequency === 'open_ended') {
    throw new ValidationError({ message: t({ key: 'budgetPlans.openEndedGoalCannotSnooze' }) });
  }
  const period = await findPeriod({ planId: params.planId, periodId });

  const start = toUtcDateString(period.startDate);
  const current = dateOrNull({ value: goal.snoozedPeriodStart });
  await goal.update({ snoozedPeriodStart: current === start ? null : start });

  return toGoal({ row: goal, decimals: await getCurrencyDecimals({ userId: params.userId, code: plan.currencyCode }) });
};

export const setLineGoal = withTransaction(setLineGoalImpl);
export const deleteLineGoal = withTransaction(deleteLineGoalImpl);
export const snoozeLineGoal = withTransaction(snoozeLineGoalImpl);
