import { RecordId } from '@bt/shared/types';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import { Op } from 'sequelize';

import { boundaryAtOrBefore } from './periods/period-enumerator';

/** A line entry as every line endpoint returns it: its categories in `currentStart`'s period. */
export const toLineEntry = ({
  line,
  lineCategories,
  currentStart,
}: {
  line: BudgetLines;
  lineCategories: BudgetLineCategories[];
  currentStart: string;
}) => ({
  id: line.id,
  name: line.name,
  sortOrder: line.sortOrder,
  activeFrom: toUtcDateString(line.activeFrom),
  activeUntil: line.activeUntil ? toUtcDateString(line.activeUntil) : null,
  categoryIds: lineCategories
    .filter(
      (row) =>
        row.lineId === line.id &&
        toUtcDateString(row.fromDate) <= currentStart &&
        (!row.untilDate || toUtcDateString(row.untilDate) > currentStart),
    )
    .map((row) => row.categoryId),
});

export const getPlan = async ({ userId, planId }: { userId: number; planId: RecordId }) => {
  const plan = await findOrThrowNotFound({
    query: BudgetPlans.findOne({ where: { id: planId, userId } }),
    message: t({ key: 'budgetPlans.planNotFound' }),
  });

  const [planAccounts, lines] = await Promise.all([
    BudgetPlanAccounts.findAll({ where: { planId: plan.id }, attributes: ['accountId'] }),
    BudgetLines.findAll({
      where: { planId: plan.id },
      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    }),
  ]);

  const lineCategories = lines.length
    ? await BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lines.map((line) => line.id) } } })
    : [];

  // Computed, not read from BudgetPeriods, so a GET stays a read.
  const currentStart = boundaryAtOrBefore({ plan, date: toUtcDateString(new Date()) });

  return {
    plan,
    accountIds: planAccounts.map((row) => row.accountId),
    lines: lines.map((line) => toLineEntry({ line, lineCategories, currentStart })),
  };
};

export const listPlans = ({ userId, includeDeleted = false }: { userId: number; includeDeleted?: boolean }) =>
  BudgetPlans.findAll({ where: { userId }, paranoid: !includeDeleted, order: [['createdAt', 'ASC']] });
