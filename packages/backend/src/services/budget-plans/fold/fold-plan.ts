import {
  BudgetPlanCarryPolicy,
  BudgetPlanPeriod,
  BudgetPlanPeriodView,
  BudgetPlanPeriodViewLine,
} from '@bt/shared/types/budget-plans';
import { toUtcDateString } from '@common/utils/date';
import { createRootCategoryResolver, getAncestorIds } from '@services/categories/category-hierarchy';

import { covers, toRange } from '../date-ranges';
import { AssignmentAmounts, resolveAssigned } from './resolve-assigned';

export interface FoldCategory {
  id: string;
  parentId: string | null;
}

export interface FoldPeriod {
  id: string;
  /** 'yyyy-MM-dd', inclusive. */
  startDate: string;
  /** 'yyyy-MM-dd', exclusive. */
  endDate: string;
}

export interface FoldLine {
  id: string;
  name: string;
  sortOrder: number;
  activeFrom: string;
  activeUntil: string | null;
}

export interface FoldLineCategory {
  lineId: string;
  categoryId: string;
  fromDate: string;
  untilDate: string | null;
}

export interface FoldAssignment extends AssignmentAmounts {
  periodId: string;
  lineId: string;
}

export interface FoldActivityRow {
  periodId: string;
  categoryId: string;
  activity: number;
}

const carriedInto = ({ policy, previous }: { policy: BudgetPlanCarryPolicy; previous: number }): number => {
  if (policy === 'none') return 0;
  if (policy === 'floor') return Math.max(0, previous);
  return previous;
};

export const toPlanPeriod = ({ period, today }: { period: FoldPeriod; today: string }): BudgetPlanPeriod => {
  const startDate = toUtcDateString(period.startDate);
  const endDate = toUtcDateString(period.endDate);
  return {
    id: period.id,
    startDate,
    endDate,
    isCurrent: covers({ range: { from: startDate, until: endDate }, start: today }),
  };
};

interface LineState {
  baseline: number;
  baselineSet: boolean;
  policy: BudgetPlanCarryPolicy;
  previousAvailable: number;
}

/**
 * Pure: the whole plan from the epoch on, one view per stored period. Every
 * amount it returns is integer cents; `Money` conversion happens at the service edge.
 */
export const foldPlan = ({
  plan,
  periods,
  lines,
  lineCategories,
  assignments,
  activityRows,
  categories,
  today,
}: {
  plan: { carryPolicy: BudgetPlanCarryPolicy };
  periods: FoldPeriod[];
  lines: FoldLine[];
  lineCategories: FoldLineCategory[];
  assignments: FoldAssignment[];
  activityRows: FoldActivityRow[];
  categories: FoldCategory[];
  today: string;
}): BudgetPlanPeriodView[] => {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const rootOf = createRootCategoryResolver({ byId });

  const rowByKey = new Map(assignments.map((row) => [`${row.periodId}:${row.lineId}`, row]));
  const activityByPeriod = new Map<string, FoldActivityRow[]>();
  for (const row of activityRows) {
    const bucket = activityByPeriod.get(row.periodId);
    if (bucket) bucket.push(row);
    else activityByPeriod.set(row.periodId, [row]);
  }

  const states = new Map<string, LineState>();

  return periods.map((source) => {
    const period = toPlanPeriod({ period: source, today });
    const start = period.startDate;
    const live = lines.filter((item) =>
      covers({ range: toRange({ from: item.activeFrom, until: item.activeUntil }), start }),
    );
    const liveIds = new Set(live.map((item) => item.id));

    const membership = lineCategories.filter(
      (item) =>
        liveIds.has(item.lineId) && covers({ range: toRange({ from: item.fromDate, until: item.untilDate }), start }),
    );

    // Ties on one membership category go to the smallest line id; nearest
    // ancestor wins across categories, which is what a re-parent needs.
    const holders = new Map<string, string>();
    for (const item of membership) {
      const held = holders.get(item.categoryId);
      if (held === undefined || item.lineId < held) holders.set(item.categoryId, item.lineId);
    }

    const ownerOf = (categoryId: string): string | null => {
      for (const id of [categoryId, ...getAncestorIds({ categoryId, byId })]) {
        const owner = holders.get(id);
        if (owner !== undefined) return owner;
      }
      return null;
    };

    const lineActivity = new Map<string, number>();
    const unbudgetedByRoot = new Map<string, number>();
    for (const row of activityByPeriod.get(period.id) ?? []) {
      const owner = ownerOf(row.categoryId);

      if (owner !== null) {
        lineActivity.set(owner, (lineActivity.get(owner) ?? 0) + row.activity);
        continue;
      }
      // Negative leaves are filtered before the roll-up, so uncovered income
      // cannot hide uncovered spending under the same root.
      if (row.activity >= 0) continue;

      const rootId = rootOf(row.categoryId);
      unbudgetedByRoot.set(rootId, (unbudgetedByRoot.get(rootId) ?? 0) + row.activity);
    }

    const viewLines = live.map((item): BudgetPlanPeriodViewLine => {
      const state: LineState = states.get(item.id) ?? {
        baseline: 0,
        baselineSet: false,
        policy: plan.carryPolicy,
        previousAvailable: 0,
      };
      const row = rowByKey.get(`${period.id}:${item.id}`);
      const { baseline, override, assigned, baselineSet } = resolveAssigned({ row, baseline: state.baseline });

      state.baseline = baseline;
      if (baselineSet) state.baselineSet = true;
      if (row?.carryPolicy != null) state.policy = row.carryPolicy;

      const activity = lineActivity.get(item.id) ?? 0;
      const carriedIn = carriedInto({ policy: state.policy, previous: state.previousAvailable });
      const available = carriedIn + assigned + activity;

      state.previousAvailable = available;
      states.set(item.id, state);

      return {
        lineId: item.id,
        name: item.name,
        sortOrder: item.sortOrder,
        categoryIds: membership.filter((entry) => entry.lineId === item.id).map((entry) => entry.categoryId),
        assigned,
        assignedSource: override !== null ? 'override' : state.baselineSet ? 'baseline' : 'none',
        activity,
        carriedIn,
        available,
        carryPolicy: state.policy,
      };
    });

    return {
      period,
      header: viewLines.reduce(
        (totals, line) => ({
          totalAssigned: totals.totalAssigned + line.assigned,
          totalActivity: totals.totalActivity + line.activity,
          totalAvailable: totals.totalAvailable + line.available,
        }),
        { totalAssigned: 0, totalActivity: 0, totalAvailable: 0 },
      ),
      lines: viewLines,
      unbudgeted: [...unbudgetedByRoot.entries()]
        .map(([categoryId, activity]) => ({ categoryId, activity }))
        .toSorted((a, b) => a.categoryId.localeCompare(b.categoryId)),
    };
  });
};
