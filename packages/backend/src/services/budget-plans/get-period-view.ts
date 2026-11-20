import { RecordId } from '@bt/shared/types';
import {
  BudgetPlanCoverage,
  BudgetPlanGoalsSummary,
  BudgetPlanLineGroup,
  BudgetPlanLinePace,
  BudgetPlanPeriodView,
  BudgetPlanPeriodViewLineGoal,
  BudgetPlanPool,
} from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { minorUnitsToApiDecimal, moneyToApiDecimalOrNull } from '@common/types/money';
import { toUtcDateString, toZonedDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import { logger } from '@js/utils/logger';
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
import { assignmentMinorUnits } from './fold/resolve-assigned';
import { goalSpecToApi, toGoalSpec } from './line-goals';
import { loadGroups } from './line-groups';
import { periodPaces } from './period-pace';
import { ensurePeriods, loadLines } from './periods/ensure-periods';
import { ownerCategories } from './validate-line-categories';

const poolToApi = ({ pool, decimals }: { pool: BudgetPlanPool; decimals: number }): BudgetPlanPool => {
  return {
    readyToAssign: minorUnitsToApiDecimal({ value: pool.readyToAssign, decimals }),
    committedLater: minorUnitsToApiDecimal({ value: pool.committedLater, decimals }),
    flow: {
      leftOver: minorUnitsToApiDecimal({ value: pool.flow.leftOver, decimals }),
      income: minorUnitsToApiDecimal({ value: pool.flow.income, decimals }),
      outsideSpending: minorUnitsToApiDecimal({ value: pool.flow.outsideSpending, decimals }),
      fromLines: minorUnitsToApiDecimal({ value: pool.flow.fromLines, decimals }),
      assigned: minorUnitsToApiDecimal({ value: pool.flow.assigned, decimals }),
    },
    balance: {
      cash: minorUnitsToApiDecimal({ value: pool.balance.cash, decimals }),
      inLines: minorUnitsToApiDecimal({ value: pool.balance.inLines, decimals }),
      drift: minorUnitsToApiDecimal({ value: pool.balance.drift, decimals }),
    },
  };
};

/** `null` before `poolFrom` or with no pool. `views` come from the explicit-future fold; minor units in, minor units out. */
const periodPool = async ({
  plan,
  views,
  periodId,
  today,
  decimals,
  timezone,
}: {
  plan: BudgetPlans;
  views: FoldedPeriodView[];
  periodId: RecordId;
  today: string;
  decimals: number;
  timezone: string;
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
    decimals,
    timezone,
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

/** Minor units. `assignedSetAside: false` asks as if nothing were assigned yet, which is what a coverage target needs. */
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
  decimals,
}: {
  plan: BudgetPlans;
  asks: Map<string, GoalEvaluation>;
  decimals: number;
}): BudgetPlanGoalsSummary => {
  const results = [...asks.entries()];
  return {
    count: results.length,
    totalTarget: minorUnitsToApiDecimal({
      value: results.reduce((sum, [, result]) => sum + result.periodTarget, 0),
      decimals,
    }),
    stillNeeded: minorUnitsToApiDecimal({ value: results.reduce((sum, [, result]) => sum + result.ask, 0), decimals }),
    underfunded: results
      .filter(([, result]) => result.status === 'underfunded')
      .map(([lineId, result]) => ({ lineId, ask: minorUnitsToApiDecimal({ value: result.ask, decimals }) })),
    expectedIncome: moneyToApiDecimalOrNull(plan.expectedIncome),
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
  decimals,
}: {
  plan: BudgetPlans;
  next: FoldedPeriodView;
  history: FoldedPeriodView[];
  goals: Map<string, LineGoal>;
  nextReadyToAssign: number;
  decimals: number;
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
    target: minorUnitsToApiDecimal({ value: target, decimals }),
    linedUp: minorUnitsToApiDecimal({ value: linedUp, decimals }),
    percent: target > 0 ? Math.min(100, Math.floor((linedUp * 100) / target)) : 0,
    left: minorUnitsToApiDecimal({ value: left, decimals }),
    state,
  };
};

const goalToApi = ({
  goal,
  result,
  decimals,
}: {
  goal: LineGoal;
  result: GoalEvaluation;
  decimals: number;
}): BudgetPlanPeriodViewLineGoal => {
  const { lineId: _lineId, snoozedPeriodStart: _snoozedPeriodStart, ...settings } = goalSpecToApi({ goal, decimals });
  return {
    ...settings,
    dueDate: result.dueDate,
    ask: minorUnitsToApiDecimal({ value: result.ask, decimals }),
    target: minorUnitsToApiDecimal({ value: result.target, decimals }),
    periodTarget: minorUnitsToApiDecimal({ value: result.periodTarget, decimals }),
    progress: minorUnitsToApiDecimal({ value: result.progress, decimals }),
    status: result.status,
    budgetAmount: minorUnitsToApiDecimal({ value: result.budgetAmount, decimals }),
    occurrences: result.occurrences,
    fundedThrough: result.fundedThrough,
    nextNeededDate: result.nextNeededDate,
    fundingPlan:
      result.fundingPlan?.map((row) => ({
        periodStart: row.periodStart,
        amount: minorUnitsToApiDecimal({ value: row.amount, decimals }),
        leftAfter: minorUnitsToApiDecimal({ value: row.leftAfter, decimals }),
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
  decimals,
  paces,
}: {
  view: FoldedPeriodView;
  groups: BudgetPlanLineGroup[];
  groupIds: Map<string, string | null>;
  pool: BudgetPlanPool | null;
  /** Minor units by line id; `null` when the pool doesn't cover the period. */
  poolAssigned: Map<string, number> | null;
  goals: Map<string, LineGoal>;
  asks: Map<string, GoalEvaluation>;
  goalsSummary: BudgetPlanGoalsSummary | null;
  coverage: BudgetPlanCoverage | null;
  decimals: number;
  paces: Map<string, BudgetPlanLinePace>;
}): BudgetPlanPeriodView => {
  return {
    period: view.period,
    header: {
      totalAssigned: minorUnitsToApiDecimal({ value: view.header.totalAssigned, decimals }),
      totalActivity: minorUnitsToApiDecimal({ value: view.header.totalActivity, decimals }),
      totalAvailable: minorUnitsToApiDecimal({ value: view.header.totalAvailable, decimals }),
      totalCarriedIn: minorUnitsToApiDecimal({ value: view.header.totalCarriedIn, decimals }),
    },
    groups,
    lines: view.lines.map((line) => ({
      lineId: line.lineId,
      name: line.name,
      sortOrder: line.sortOrder,
      groupId: groupIds.get(line.lineId) ?? null,
      categoryIds: line.categoryIds,
      assigned: minorUnitsToApiDecimal({ value: line.assigned, decimals }),
      poolAssigned: minorUnitsToApiDecimal({ value: poolAssigned?.get(line.lineId) ?? line.assigned, decimals }),
      assignedSource: line.assignedSource,
      activity: minorUnitsToApiDecimal({ value: line.activity, decimals }),
      carriedIn: minorUnitsToApiDecimal({ value: line.carriedIn, decimals }),
      available: minorUnitsToApiDecimal({ value: line.available, decimals }),
      carryPolicy: line.carryPolicy,
      goal: asks.has(line.lineId)
        ? goalToApi({ goal: goals.get(line.lineId)!, result: asks.get(line.lineId)!, decimals })
        : null,
      pace: paces.get(line.lineId) ?? null,
    })),
    unbudgeted: view.unbudgeted.map((entry) => ({
      categoryId: entry.categoryId,
      activity: minorUnitsToApiDecimal({ value: entry.activity, decimals }),
    })),
    pool: pool && poolToApi({ pool, decimals }),
    goals: summary,
    coverage,
  };
};

const loadGoalRows = ({ planId }: { planId: RecordId }): Promise<BudgetLineGoals[]> =>
  BudgetLineGoals.findAll({
    include: [{ model: BudgetLines, where: { planId }, attributes: [] }],
  });

/**
 * Everything `foldPlan` needs for the whole plan, periods ensured through today, plus the plan
 * currency's `decimals` its minor units are at.
 */
export const loadFoldInput = async ({
  plan,
  today,
  timezone,
}: {
  plan: BudgetPlans;
  today: string;
  timezone: string;
}) => {
  const periods = await ensurePeriods({ plan, today });
  const decimals = await getCurrencyDecimals({ userId: plan.userId, code: plan.currencyCode });

  const [lines, { categories }, activityRows] = await Promise.all([
    loadLines({ planId: plan.id }),
    ownerCategories({ userId: plan.userId }),
    getPlanActivity({ plan, periods, decimals, timezone }),
  ]);

  const lineIds = lines.map((line) => line.id);
  const [lineCategories, assignments] = await Promise.all([
    BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
    BudgetAssignments.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
  ]);

  return {
    plan,
    decimals,
    periods,
    lines,
    lineCategories,
    assignments: assignments.map((row) => ({
      periodId: row.periodId,
      lineId: row.lineId,
      ...assignmentMinorUnits({ row, decimals }),
    })),
    activityRows,
    categories: categories.map((category) => ({
      id: category.id,
      parentId: category.parentId ?? null,
    })),
    today,
  };
};

export type FoldInput = Awaited<ReturnType<typeof loadFoldInput>>;

/** Folds the whole plan from the epoch to answer for one period. */
export const getPeriodView = async ({
  userId,
  planId,
  periodId,
  timezone,
}: {
  userId: number;
  planId: RecordId;
  periodId: RecordId;
  timezone: string;
}): Promise<BudgetPlanPeriodView> => {
  const plan = await findPlan({ planId, userId });

  const today = toZonedDateString({ date: new Date(), timezone });
  const [foldInput, groups, goalRows] = await Promise.all([
    loadFoldInput({ plan, today, timezone }),
    loadGroups({ planId: plan.id }),
    loadGoalRows({ planId: plan.id }),
  ]);
  const { decimals } = foldInput;
  const goals = new Map(goalRows.map((row) => [row.lineId, toGoalSpec({ row, decimals })]));
  const index = foldInput.periods.findIndex((period) => period.id === periodId);
  if (index === -1) {
    throw new NotFoundError({
      message: t({ key: 'budgetPlans.periodNotFound' }),
    });
  }

  const views = foldPlan(foldInput);
  const view = views[index]!;
  const explicitViews = plan.poolFrom ? foldPlan({ ...foldInput, explicitFutureOnly: true }) : [];
  const [poolResult, paces] = await Promise.all([
    plan.poolFrom ? periodPool({ plan, views: explicitViews, periodId, today, decimals, timezone }) : null,
    periodPaces({ plan, foldInput, index, view, today, timezone }).catch((error) => {
      logger.error({ message: 'Failed to compute budget line paces', error }, { planId: plan.id, periodId });
      return new Map<string, BudgetPlanLinePace>();
    }),
  ]);

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
          decimals,
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
    goalsSummary: goals.size ? goalsSummary({ plan, asks, decimals }) : null,
    coverage,
    decimals,
    paces,
  });
};
