import { GoalInsights, GoalModel, RecordId } from '@bt/shared/types';
import { moneyToApiDecimal, moneyToApiDecimalOrNull } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { namespace } from '@models/connection';
import GoalAccounts from '@models/goal-accounts.model';
import Goals from '@models/goals.model';
import { serializeLogoFields } from '@root/serializers/logo-fields.serializer';
import { withTransaction } from '@services/common/with-transaction';

import { loadGoalInsights, loadHeldFixedAmounts } from './goal-insights';

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
    include: [
      {
        model: GoalAccounts,
        as: 'goalAccounts',
        attributes: ['accountId', 'sharePercent', 'fixedAmount'],
      },
    ],
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

/**
 * The goal's place among the account's held fixed amounts, dense so a write can echo it back. A goal
 * holding none there (archived) is last, where unarchiving places it.
 */
const fixedRank = ({
  heldFixedAmounts,
  goalId,
  accountId,
}: {
  heldFixedAmounts: GoalAccounts[];
  goalId: RecordId;
  accountId: RecordId;
}): number => {
  const held = heldFixedAmounts.filter((row) => row.accountId === accountId);
  const rank = held.findIndex((row) => row.goalId === goalId);
  return rank === -1 ? held.length : rank;
};

const toGoalResponse = ({
  goal,
  insights,
  heldFixedAmounts,
}: {
  goal: Goals;
  insights: GoalInsights | null;
  heldFixedAmounts: GoalAccounts[];
}): GoalModel => ({
  id: goal.id,
  name: goal.name,
  currencyCode: goal.currencyCode,
  targetAmount: moneyToApiDecimal(goal.targetAmount),
  targetDate: goal.targetDate,
  plannedMonthly: moneyToApiDecimalOrNull(goal.plannedMonthly),
  status: goal.status,
  achievedAt: goal.achievedAt ? goal.achievedAt.toISOString() : null,
  achievedAmount: moneyToApiDecimalOrNull(goal.achievedAmount),
  sortOrder: goal.sortOrder,
  reachedHoldDays: goal.reachedHoldDays,
  ...serializeLogoFields({ entity: goal }),
  accounts: (goal.goalAccounts ?? []).map(({ accountId, sharePercent, fixedAmount }) => ({
    accountId,
    sharePercent,
    fixedAmount: moneyToApiDecimalOrNull(fixedAmount),
    fixedPosition: fixedAmount === null ? null : fixedRank({ heldFixedAmounts, goalId: goal.id, accountId }),
  })),
  insights,
  createdAt: goal.createdAt.toISOString(),
  updatedAt: goal.updatedAt.toISOString(),
});

/** One read transaction pins a single connection across the insights fan-out. */
export const loadGoalsWithInsights = withTransaction(
  async ({ userId, goalIds }: { userId: number; goalIds?: RecordId[] }): Promise<GoalModel[]> => {
    const goals = await queryGoals({ userId, goalIds });
    const heldFixedAmounts = await loadHeldFixedAmounts({
      userId,
      accountIds: [...new Set(goals.flatMap((goal) => (goal.goalAccounts ?? []).map((link) => link.accountId)))],
    });
    const insightsByGoal = await loadGoalInsights({ userId, goals, heldFixedAmounts });
    return goals.map((goal) =>
      toGoalResponse({ goal, insights: insightsByGoal.get(goal.id) ?? null, heldFixedAmounts }),
    );
  },
);

export const listGoals = ({ userId }: { userId: number }): Promise<GoalModel[]> => loadGoalsWithInsights({ userId });

export const getGoal = async ({ userId, goalId }: { userId: number; goalId: RecordId }): Promise<GoalModel> => {
  const [goal] = await loadGoalsWithInsights({ userId, goalIds: [goalId] });
  return goal ?? throwGoalNotFound();
};
