import { RecordId } from '@bt/shared/types';
import {
  BudgetPlanCoverage,
  BudgetPlanGoalsSummary,
  BudgetPlanLineGroup,
  BudgetPlanPeriodView,
  BudgetPlanPeriodViewLineGoal,
  BudgetPlanPool,
} from '@bt/shared/types';
import { centsToApiDecimal, centsToApiDecimalOrNull } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLineGoals from '@models/budget-line-goals.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlans from '@models/budget-plans.model';
import { Op } from 'sequelize';

import { getPlanActivity } from './activity/get-plan-activity';
import { getPlanCash } from './activity/get-plan-cash';
import { addUtcDays } from './date-ranges';
import { findPlan } from './find-plan';
import { FoldedPeriodView, foldPlan } from './fold/fold-plan';
import { foldPool } from './fold/fold-pool';
import { GoalEvaluation, GoalPeriodAssigned, GoalSpec, evaluateGoal } from './fold/goal-ask';
import { assignmentCents } from './fold/resolve-assigned';
import { goalSpecToApi, toGoalSpec } from './line-goals';
import { loadGroups } from './line-groups';
import { ensurePeriods, loadLines } from './periods/ensure-periods';
import { ownerCategories } from './validate-line-categories';

const poolToApi = ({ pool }: { pool: BudgetPlanPool }): BudgetPlanPool => ({
  readyToAssign: centsToApiDecimal(pool.readyToAssign),
  committedLater: centsToApiDecimal(pool.committedLater),
  flow: {
    leftOver: centsToApiDecimal(pool.flow.leftOver),
    income: centsToApiDecimal(pool.flow.income),
    outsideSpending: centsToApiDecimal(pool.flow.outsideSpending),
    fromLines: centsToApiDecimal(pool.flow.fromLines),
    assigned: centsToApiDecimal(pool.flow.assigned),
  },
  balance: {
    cash: centsToApiDecimal(pool.balance.cash),
    inLines: centsToApiDecimal(pool.balance.inLines),
    drift: centsToApiDecimal(pool.balance.drift),
  },
});

/** `null` before `poolFrom` or with no pool. `views` come from the explicit-future fold; cents in, cents out. */
const periodPool = async ({
  plan,
  views,
  periodId,
  today,
}: {
  plan: BudgetPlans;
  views: FoldedPeriodView[];
  periodId: RecordId;
  today: string;
}): Promise<{ pool: BudgetPlanPool; nextReadyToAssign: number | null } | null> => {
  if (!plan.poolFrom) return null;
  const poolFrom = toUtcDateString(plan.poolFrom);
  const view = views.find((entry) => entry.period.id === periodId)!;
  if (view.period.startDate < poolFrom) return null;

  const poolViews = views.filter((entry) => entry.period.startDate >= poolFrom);
  const tomorrow = addUtcDays({ date: today, days: 1 });
  const { opening, closing: cash } = await getPlanCash({
    plan,
    opening: poolFrom,
    closing: view.period.endDate < tomorrow ? view.period.endDate : tomorrow,
  });

  const entries = foldPool({ periods: poolViews, openingCash: opening });
  const index = poolViews.indexOf(view);
  const entry = entries[index]!;
  const inLines = view.header.totalAvailable;

  return {
    pool: {
      ...entry,
      balance: {
        cash,
        inLines,
        drift: cash - inLines - entry.readyToAssign - entry.committedLater,
      },
    },
    nextReadyToAssign: entries[index + 1]?.readyToAssign ?? null,
  };
};

type LineGoal = GoalSpec & { lineId: RecordId };

const goalHistories = ({
  views,
  goals,
}: {
  views: FoldedPeriodView[];
  goals: Map<string, LineGoal>;
}): Map<string, GoalPeriodAssigned[]> => {
  const histories = new Map<string, GoalPeriodAssigned[]>([...goals.keys()].map((lineId) => [lineId, []]));
  for (const view of views) {
    for (const line of view.lines) {
      histories.get(line.lineId)?.push({ start: view.period.startDate, assigned: line.assigned });
    }
  }
  return histories;
};

/** Cents. `assignedSetAside: false` asks as if nothing were assigned yet, which is what a coverage target needs. */
const evaluateGoals = ({
  plan,
  view,
  views,
  goals,
  assignedSetAside = true,
}: {
  plan: BudgetPlans;
  view: FoldedPeriodView;
  views: FoldedPeriodView[];
  goals: Map<string, LineGoal>;
  assignedSetAside?: boolean;
}): Map<string, GoalEvaluation> => {
  const histories = goalHistories({ views, goals });
  const period = { start: view.period.startDate, end: view.period.endDate };
  const results = new Map<string, GoalEvaluation>();
  for (const line of view.lines) {
    const goal = goals.get(line.lineId);
    if (!goal) continue;
    const figures = assignedSetAside ? line : { ...line, assigned: 0, available: line.available - line.assigned };
    results.set(line.lineId, evaluateGoal({ goal, line: figures, period, history: histories.get(line.lineId)!, plan }));
  }
  return results;
};

const goalsSummary = ({
  plan,
  asks,
}: {
  plan: BudgetPlans;
  asks: Map<string, GoalEvaluation>;
}): BudgetPlanGoalsSummary => {
  const results = [...asks.entries()];
  return {
    count: results.length,
    totalTarget: centsToApiDecimal(results.reduce((sum, [, result]) => sum + result.periodTarget, 0)),
    stillNeeded: centsToApiDecimal(results.reduce((sum, [, result]) => sum + result.ask, 0)),
    underfunded: results
      .filter(([, result]) => result.status === 'underfunded')
      .map(([lineId, result]) => ({ lineId, ask: centsToApiDecimal(result.ask) })),
    expectedIncome: centsToApiDecimalOrNull(plan.expectedIncome),
  };
};

const HISTORY_PERIODS = 3;

/**
 * `next` is the explicit-future fold's next period, `history` the plain fold's
 * periods up to the viewed one. A line without a goal counts the average of
 * its last three assigned amounts, over the periods it existed in.
 */
const nextCoverage = ({
  plan,
  next,
  history,
  goals,
  nextReadyToAssign,
}: {
  plan: BudgetPlans;
  next: FoldedPeriodView;
  history: FoldedPeriodView[];
  goals: Map<string, LineGoal>;
  nextReadyToAssign: number;
}): BudgetPlanCoverage => {
  const asks = evaluateGoals({ plan, view: next, views: history, goals, assignedSetAside: false });
  const recent = history.slice(-HISTORY_PERIODS);

  const target = next.lines.reduce((sum, line) => {
    const goal = asks.get(line.lineId);
    if (goal) return sum + goal.ask;
    const assigned = recent.flatMap((view) =>
      view.lines.filter((entry) => entry.lineId === line.lineId).map((entry) => entry.assigned),
    );
    return assigned.length ? sum + Math.round(assigned.reduce((a, b) => a + b, 0) / assigned.length) : sum;
  }, 0);

  const linedUp = next.header.totalAssigned + Math.max(0, nextReadyToAssign);
  const left = Math.max(0, target - linedUp);

  let state: BudgetPlanCoverage['state'];
  if (nextReadyToAssign < 0) state = 'over_committed';
  else if (target === 0) state = 'nothing_tracked';
  else if (left === 0) state = 'prepared';
  else state = 'left_to_cover';

  return {
    periodId: next.period.id,
    startDate: next.period.startDate,
    endDate: next.period.endDate,
    target: centsToApiDecimal(target),
    linedUp: centsToApiDecimal(linedUp),
    percent: target > 0 ? Math.min(100, Math.floor((linedUp * 100) / target)) : 0,
    left: centsToApiDecimal(left),
    state,
  };
};

const goalToApi = ({ goal, result }: { goal: LineGoal; result: GoalEvaluation }): BudgetPlanPeriodViewLineGoal => {
  const { lineId: _lineId, snoozedPeriodStart: _snoozedPeriodStart, ...settings } = goalSpecToApi({ goal });
  return {
    ...settings,
    dueDate: result.dueDate,
    ask: centsToApiDecimal(result.ask),
    target: centsToApiDecimal(result.target),
    periodTarget: centsToApiDecimal(result.periodTarget),
    progress: centsToApiDecimal(result.progress),
    status: result.status,
    budgetAmount: centsToApiDecimal(result.budgetAmount),
    occurrences: result.occurrences,
    fundedThrough: result.fundedThrough,
    nextNeededDate: result.nextNeededDate,
    fundingPlan:
      result.fundingPlan?.map((row) => ({
        periodStart: row.periodStart,
        amount: centsToApiDecimal(row.amount),
        leftAfter: centsToApiDecimal(row.leftAfter),
      })) ?? null,
  };
};

const toApi = ({
  view,
  groups,
  groupIds,
  pool,
  poolAssigned,
  goals,
  asks,
  goalsSummary: summary,
  coverage,
}: {
  view: FoldedPeriodView;
  groups: BudgetPlanLineGroup[];
  groupIds: Map<string, string | null>;
  pool: BudgetPlanPool | null;
  /** Cents by line id; `null` when the pool doesn't cover the period. */
  poolAssigned: Map<string, number> | null;
  goals: Map<string, LineGoal>;
  asks: Map<string, GoalEvaluation>;
  goalsSummary: BudgetPlanGoalsSummary | null;
  coverage: BudgetPlanCoverage | null;
}): BudgetPlanPeriodView => ({
  period: view.period,
  header: {
    totalAssigned: centsToApiDecimal(view.header.totalAssigned),
    totalActivity: centsToApiDecimal(view.header.totalActivity),
    totalAvailable: centsToApiDecimal(view.header.totalAvailable),
    totalCarriedIn: centsToApiDecimal(view.header.totalCarriedIn),
  },
  groups,
  lines: view.lines.map((line) => ({
    lineId: line.lineId,
    name: line.name,
    sortOrder: line.sortOrder,
    groupId: groupIds.get(line.lineId) ?? null,
    categoryIds: line.categoryIds,
    assigned: centsToApiDecimal(line.assigned),
    poolAssigned: centsToApiDecimal(poolAssigned?.get(line.lineId) ?? line.assigned),
    assignedSource: line.assignedSource,
    activity: centsToApiDecimal(line.activity),
    carriedIn: centsToApiDecimal(line.carriedIn),
    available: centsToApiDecimal(line.available),
    carryPolicy: line.carryPolicy,
    goal: asks.has(line.lineId) ? goalToApi({ goal: goals.get(line.lineId)!, result: asks.get(line.lineId)! }) : null,
  })),
  unbudgeted: view.unbudgeted.map((entry) => ({
    categoryId: entry.categoryId,
    activity: centsToApiDecimal(entry.activity),
  })),
  pool: pool && poolToApi({ pool }),
  goals: summary,
  coverage,
});

const loadGoals = async ({ planId }: { planId: RecordId }): Promise<Map<string, LineGoal>> => {
  const rows = await BudgetLineGoals.findAll({
    include: [{ model: BudgetLines, where: { planId }, attributes: [] }],
  });
  return new Map(rows.map((row) => [row.lineId, toGoalSpec({ row })]));
};

/** Everything `foldPlan` needs for the whole plan, periods ensured through today. */
export const loadFoldInput = async ({ plan, today }: { plan: BudgetPlans; today: string }) => {
  const periods = await ensurePeriods({ plan, today });

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

  return {
    plan,
    periods,
    lines,
    lineCategories,
    assignments: assignments.map((row) => ({
      periodId: row.periodId,
      lineId: row.lineId,
      ...assignmentCents(row),
    })),
    activityRows,
    categories: categories.map((category) => ({
      id: category.id,
      parentId: category.parentId ?? null,
    })),
    today,
  };
};

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
  const [foldInput, goals, groups] = await Promise.all([
    loadFoldInput({ plan, today }),
    loadGoals({ planId: plan.id }),
    loadGroups({ planId: plan.id }),
  ]);
  const index = foldInput.periods.findIndex((period) => period.id === periodId);
  if (index === -1) {
    throw new NotFoundError({
      message: t({ key: 'budgetPlans.periodNotFound' }),
    });
  }

  const views = foldPlan(foldInput);
  const view = views[index]!;
  const explicitViews = plan.poolFrom ? foldPlan({ ...foldInput, explicitFutureOnly: true }) : [];
  const poolResult = plan.poolFrom ? await periodPool({ plan, views: explicitViews, periodId, today }) : null;

  const asks = evaluateGoals({ plan, view, views, goals });
  const next = explicitViews[index + 1];
  const coverage =
    poolResult && next && poolResult.nextReadyToAssign !== null
      ? nextCoverage({
          plan,
          next,
          history: views.slice(0, index + 1),
          goals,
          nextReadyToAssign: poolResult.nextReadyToAssign,
        })
      : null;

  return toApi({
    view,
    groups,
    groupIds: new Map(foldInput.lines.map((line) => [line.id, line.groupId])),
    pool: poolResult?.pool ?? null,
    poolAssigned: poolResult && new Map(explicitViews[index]!.lines.map((line) => [line.lineId, line.assigned])),
    goals,
    asks,
    goalsSummary: goals.size ? goalsSummary({ plan, asks }) : null,
    coverage,
  });
};
