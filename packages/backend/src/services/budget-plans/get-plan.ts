import { RecordId } from '@bt/shared/types';
import { BudgetPlanDetails, BudgetPlanLineEntry } from '@bt/shared/types';
import { centsToApiDecimalOrNull } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import { Op } from 'sequelize';

import { covers, toRange } from './date-ranges';
import { findPlan } from './find-plan';
import { loadLines } from './periods/ensure-periods';
import { currentPeriodStart } from './periods/period-enumerator';

/** A line entry as every line endpoint returns it: its categories in `currentStart`'s period. */
export const toLineEntry = ({
  line,
  lineCategories,
  currentStart,
}: {
  line: BudgetLines;
  lineCategories: BudgetLineCategories[];
  currentStart: string;
}): BudgetPlanLineEntry => ({
  id: line.id,
  name: line.name,
  sortOrder: line.sortOrder,
  groupId: line.groupId,
  activeFrom: toUtcDateString(line.activeFrom),
  activeUntil: line.activeUntil ? toUtcDateString(line.activeUntil) : null,
  categoryIds: lineCategories
    .filter(
      (row) =>
        row.lineId === line.id &&
        covers({ range: toRange({ from: row.fromDate, until: row.untilDate }), start: currentStart }),
    )
    .map((row) => row.categoryId),
});

export const getPlan = async ({ userId, planId }: { userId: number; planId: RecordId }): Promise<BudgetPlanDetails> => {
  const plan = await findPlan({ planId, userId });

  const [planAccounts, lines] = await Promise.all([
    BudgetPlanAccounts.findAll({ where: { planId: plan.id }, attributes: ['accountId'] }),
    loadLines({ planId: plan.id }),
  ]);

  const lineCategories = lines.length
    ? await BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lines.map((line) => line.id) } } })
    : [];

  // Computed, not read from BudgetPeriods, so a GET stays a read.
  const currentStart = currentPeriodStart({ plan });

  return {
    plan: { ...plan.get({ plain: true }), expectedIncome: centsToApiDecimalOrNull(plan.expectedIncome) },
    accountIds: planAccounts.map((row) => row.accountId),
    lines: lines.map((line) => toLineEntry({ line, lineCategories, currentStart })),
  };
};

export const listPlans = ({ userId, includeDeleted = false }: { userId: number; includeDeleted?: boolean }) =>
  BudgetPlans.findAll({ where: { userId }, paranoid: !includeDeleted, order: [['createdAt', 'ASC']] });
