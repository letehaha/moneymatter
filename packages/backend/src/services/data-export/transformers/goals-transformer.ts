import { centsToApiDecimal, centsToApiDecimalOrNull } from '@common/types/money';
import Accounts from '@models/accounts.model';
import GoalAccounts from '@models/goal-accounts.model';
import Goals from '@models/goals.model';
import { Op } from 'sequelize';

import type { GoalRow } from '../types';
import { resolveRelationName, toDateOnly } from './utils';

export async function transformGoals({ userId }: { userId: number }): Promise<GoalRow[]> {
  const goals = await Goals.findAll({
    where: { userId },
    order: [
      ['sortOrder', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });
  if (goals.length === 0) return [];

  const links = await GoalAccounts.findAll({ where: { goalId: { [Op.in]: goals.map((g) => g.id) } } });
  const accountIds = [...new Set(links.map((l) => l.accountId))];

  // `userId` guard: a stray cross-user accountId in the link table must not leak another user's account name.
  const accounts = accountIds.length
    ? await Accounts.findAll({ where: { userId, id: { [Op.in]: accountIds } }, attributes: ['id', 'name'] })
    : [];
  const accountNameById = new Map(accounts.map((a) => [String(a.id), a.name]));

  const sharesByGoalId = new Map<string, string[]>();
  for (const link of links) {
    const name = resolveRelationName({
      id: String(link.accountId),
      nameById: accountNameById,
      relation: 'account',
      context: `goal ${link.goalId}`,
    });
    const list = sharesByGoalId.get(link.goalId) ?? [];
    list.push(`${name}: ${link.sharePercent}%`);
    sharesByGoalId.set(link.goalId, list);
  }

  return goals.map(
    (goal): GoalRow => ({
      name: goal.name,
      status: goal.status,
      targetAmount: centsToApiDecimal(goal.targetAmount),
      currency: goal.currencyCode,
      targetDate: goal.targetDate ?? '',
      plannedMonthly: centsToApiDecimalOrNull(goal.plannedMonthly),
      accounts: (sharesByGoalId.get(goal.id) ?? []).toSorted(),
      achievedAt: goal.achievedAt ? toDateOnly({ value: goal.achievedAt }) : '',
      achievedAmount: centsToApiDecimalOrNull(goal.achievedAmount),
    }),
  );
}
