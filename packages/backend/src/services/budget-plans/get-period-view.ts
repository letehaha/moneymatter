import { RecordId } from '@bt/shared/types';
import { BudgetPlanPeriodView } from '@bt/shared/types/budget-plans';
import { centsToApiDecimal } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import { Op } from 'sequelize';

import { getPlanActivity } from './activity/get-plan-activity';
import { findPlan } from './find-plan';
import { foldPlan } from './fold/fold-plan';
import { assignmentCents } from './fold/resolve-assigned';
import { ensurePeriods, loadLines } from './periods/ensure-periods';
import { ownerCategories } from './validate-line-categories';

const toApi = (view: BudgetPlanPeriodView): BudgetPlanPeriodView => ({
  period: view.period,
  header: {
    totalAssigned: centsToApiDecimal(view.header.totalAssigned),
    totalActivity: centsToApiDecimal(view.header.totalActivity),
    totalAvailable: centsToApiDecimal(view.header.totalAvailable),
  },
  lines: view.lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    sortOrder: line.sortOrder,
    categoryIds: line.categoryIds,
    assigned: centsToApiDecimal(line.assigned),
    assignedSource: line.assignedSource,
    activity: centsToApiDecimal(line.activity),
    carriedIn: centsToApiDecimal(line.carriedIn),
    available: centsToApiDecimal(line.available),
    carryPolicy: line.carryPolicy,
  })),
  unbudgeted: view.unbudgeted.map((entry) => ({
    categoryId: entry.categoryId,
    activity: centsToApiDecimal(entry.activity),
  })),
});

/** Folds the whole plan from the epoch to answer for one period. */
export const getPeriodView = async ({
  userId,
  planId,
  periodId,
}: {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
}): Promise<BudgetPlanPeriodView> => {
  const plan = await findPlan({ planId, userId });

  const today = toUtcDateString(new Date());
  const periods = await ensurePeriods({ plan, today });
  if (!periods.some((period) => period.id === periodId)) {
    throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });
  }

  const [lines, { categories }, activityRows] = await Promise.all([
    loadLines({ planId: plan.id }),
    ownerCategories({ userId: plan.userId }),
    getPlanActivity({ plan, periods }),
  ]);

  const lineIds = lines.map((line) => line.id);
  const [lineCategories, assignments] = await Promise.all([
    BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
    BudgetAssignments.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
  ]);

  const views = foldPlan({
    plan,
    periods,
    lines,
    lineCategories,
    assignments: assignments.map((row) => ({ periodId: row.periodId, lineId: row.lineId, ...assignmentCents(row) })),
    activityRows,
    categories: categories.map((category) => ({ id: category.id, parentId: category.parentId ?? null })),
    today,
  });

  return toApi(views.find((view) => view.period.id === periodId)!);
};
