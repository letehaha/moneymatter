import { GoalInsights, GoalModel, RecordId } from '@bt/shared/types';
import { centsToApiDecimal, centsToApiDecimalOrNull } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { namespace } from '@models/connection';
import GoalAccounts from '@models/goal-accounts.model';
import Goals from '@models/goals.model';
import { serializeLogoFields } from '@root/serializers/logo-fields.serializer';
import { withTransaction } from '@services/common/with-transaction';

import { loadGoalInsights } from './goal-insights';

interface QueryGoalsParams {
  userId: number;
  goalIds?: RecordId[];
  /** Skips the accounts: Postgres refuses FOR UPDATE on the nullable side of an outer join. */
  lock?: boolean;
}

const queryGoals = ({ userId, goalIds, lock = false }: QueryGoalsParams): Promise<Goals[]> => {
  const where = { userId, ...(goalIds && { id: goalIds }) };
  if (lock) {
    const transaction = namespace.get('transaction');
    if (!transaction) throw new Error('Locking a goal requires a CLS transaction');
    return Goals.findAll({ where, lock: transaction.LOCK.NO_KEY_UPDATE });
  }

  return Goals.findAll({
    where,
    include: [{ model: GoalAccounts, as: 'goalAccounts', attributes: ['accountId', 'sharePercent'] }],
    order: [
      ['sortOrder', 'ASC'],
      ['createdAt', 'ASC'],
      [{ model: GoalAccounts, as: 'goalAccounts' }, 'accountId', 'ASC'],
    ],
  });
};

export const throwGoalNotFound = (): never => {
  throw new NotFoundError({ message: t({ key: 'goals.goalNotFound' }) });
};

export const findGoal = async ({ userId, goalId, lock }: { userId: number; goalId: RecordId; lock?: boolean }) => {
  const [goal] = await queryGoals({ userId, goalIds: [goalId], lock });
  return goal ?? throwGoalNotFound();
};

const toGoalResponse = ({ goal, insights }: { goal: Goals; insights: GoalInsights | null }): GoalModel => ({
  id: goal.id,
  name: goal.name,
  currencyCode: goal.currencyCode,
  targetAmount: centsToApiDecimal(goal.targetAmount),
  targetDate: goal.targetDate,
  plannedMonthly: centsToApiDecimalOrNull(goal.plannedMonthly),
  status: goal.status,
  achievedAt: goal.achievedAt ? goal.achievedAt.toISOString() : null,
  achievedAmount: centsToApiDecimalOrNull(goal.achievedAmount),
  sortOrder: goal.sortOrder,
  ...serializeLogoFields({ entity: goal }),
  accounts: (goal.goalAccounts ?? []).map(({ accountId, sharePercent }) => ({ accountId, sharePercent })),
  insights,
  createdAt: goal.createdAt.toISOString(),
  updatedAt: goal.updatedAt.toISOString(),
});

/** One read transaction pins a single connection across the insights fan-out. */
export const loadGoalsWithInsights = withTransaction(
  async ({ userId, goalIds }: { userId: number; goalIds?: RecordId[] }): Promise<GoalModel[]> => {
    const goals = await queryGoals({ userId, goalIds });
    const insightsByGoal = await loadGoalInsights({ userId, goals });
    return goals.map((goal) => toGoalResponse({ goal, insights: insightsByGoal.get(goal.id) ?? null }));
  },
);

export const listGoals = ({ userId }: { userId: number }): Promise<GoalModel[]> => loadGoalsWithInsights({ userId });

export const getGoal = async ({ userId, goalId }: { userId: number; goalId: RecordId }): Promise<GoalModel> => {
  const [goal] = await loadGoalsWithInsights({ userId, goalIds: [goalId] });
  return goal ?? throwGoalNotFound();
};
