import { RecordId } from '@bt/shared/types';
import { centsToApiDecimal } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import { Op } from 'sequelize';

import { getPlanActivity } from './activity/get-plan-activity';
import { PeriodView, foldPlan } from './fold/fold-plan';
import { ensurePeriods } from './periods/ensure-periods';

const toApi = (view: PeriodView) => ({
  period: view.period,
  header: {
    totalAssigned: centsToApiDecimal(view.header.totalAssigned),
    totalActivity: centsToApiDecimal(view.header.totalActivity),
    totalAvailable: centsToApiDecimal(view.header.totalAvailable),
  },
  lines: view.lines.map((line) => ({
    ...line,
    assigned: centsToApiDecimal(line.assigned),
    activity: centsToApiDecimal(line.activity),
    carriedIn: centsToApiDecimal(line.carriedIn),
    available: centsToApiDecimal(line.available),
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
}) => {
  const plan = await findOrThrowNotFound({
    query: BudgetPlans.findOne({ where: { id: planId, userId } }),
    message: t({ key: 'budgetPlans.planNotFound' }),
  });

  // One clock read: a request that crosses UTC midnight between materialising
  // the periods and folding them would otherwise report no current period.
  const today = toUtcDateString(new Date());
  const periods = await ensurePeriods({ plan, upTo: today });
  if (!periods.some((period) => period.id === periodId)) {
    throw new NotFoundError({ message: t({ key: 'budgetPlans.periodNotFound' }) });
  }

  const [lines, categories, activityRows] = await Promise.all([
    BudgetLines.findAll({
      where: { planId: plan.id },
      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    }),
    Categories.findAll({ where: { userId: plan.userId }, attributes: ['id', 'parentId'] }),
    getPlanActivity({ plan, periods }),
  ]);

  const lineIds = lines.map((line) => line.id);
  const [lineCategories, assignments] = lineIds.length
    ? await Promise.all([
        BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
        BudgetAssignments.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
      ])
    : [[] as BudgetLineCategories[], [] as BudgetAssignments[]];

  const views = foldPlan({
    plan,
    periods: periods.map((period) => ({
      id: period.id,
      startDate: toUtcDateString(period.startDate),
      endDate: toUtcDateString(period.endDate),
    })),
    lines: lines.map((line) => ({
      id: line.id,
      name: line.name,
      sortOrder: line.sortOrder,
      activeFrom: toUtcDateString(line.activeFrom),
      activeUntil: line.activeUntil === null ? null : toUtcDateString(line.activeUntil),
    })),
    lineCategories: lineCategories.map((row) => ({
      lineId: row.lineId,
      categoryId: row.categoryId,
      fromDate: toUtcDateString(row.fromDate),
      untilDate: row.untilDate === null ? null : toUtcDateString(row.untilDate),
    })),
    assignments: assignments.map((row) => ({
      periodId: row.periodId,
      lineId: row.lineId,
      baselineAmount: row.baselineAmount === null ? null : row.baselineAmount.toCents(),
      overrideAmount: row.overrideAmount === null ? null : row.overrideAmount.toCents(),
      carryPolicy: row.carryPolicy,
    })),
    activityRows,
    categories: categories.map((category) => ({ id: category.id, parentId: category.parentId ?? null })),
    today,
  });

  return toApi(views.find((view) => view.period.id === periodId)!);
};
