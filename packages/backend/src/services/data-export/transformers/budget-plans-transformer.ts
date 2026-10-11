import type {
  BudgetLineGoalBehavior,
  BudgetLineGoalFrequency,
  BudgetLineGoalRepeatUnit,
  RecordId,
} from '@bt/shared/types';
import { Money, centsToApiDecimal } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLineGoals from '@models/budget-line-goals.model';
import BudgetLineGroups from '@models/budget-line-groups.model';
import BudgetLines from '@models/budget-lines.model';
import Categories from '@models/categories.model';
import { addUtcDays } from '@services/budget-plans/date-ranges';
import { foldPlan } from '@services/budget-plans/fold/fold-plan';
import type { GoalSpec } from '@services/budget-plans/fold/goal-ask';
import { loadFoldInput } from '@services/budget-plans/get-period-view';
import { listPlans, toLineEntry } from '@services/budget-plans/get-plan';
import { toGoalSpec } from '@services/budget-plans/line-goals';
import { boundaryAtOrBefore } from '@services/budget-plans/periods/period-enumerator';
import { Op } from 'sequelize';

import type { BudgetLineRow, BudgetPeriodRow, ExportDateRange } from '../types';
import { resolveRelationName } from './utils';

const GOAL_BEHAVIORS: Record<BudgetLineGoalBehavior, string> = {
  budget_another: 'Budget another',
  refill_up_to: 'Refill up to',
  reach_balance: 'Reach a balance',
};

const repeatText = ({ every, unit }: { every: number; unit: BudgetLineGoalRepeatUnit }): string =>
  every === 1 ? `repeating every ${unit.slice(0, -1)}` : `repeating every ${every} ${unit}`;

const GOAL_FREQUENCIES: Record<BudgetLineGoalFrequency, (goal: GoalSpec) => string> = {
  every_period: () => 'every period',
  weekly: () => 'every week',
  biweekly: () => 'every 2 weeks',
  yearly: (goal) => `every year, first due ${goal.anchorDate}`,
  by_date: (goal) =>
    goal.repeatEvery && goal.repeatUnit
      ? `by ${goal.anchorDate}, ${repeatText({ every: goal.repeatEvery, unit: goal.repeatUnit })}`
      : `by ${goal.anchorDate}`,
  open_ended: () => '',
};

const goalText = ({ goal }: { goal: GoalSpec }): string =>
  [
    GOAL_BEHAVIORS[goal.behavior],
    Money.fromCents(goal.amount).toDecimalString(2),
    GOAL_FREQUENCIES[goal.frequency](goal),
  ]
    .filter(Boolean)
    .join(' ');

const loadGroupsByPlan = async ({ planIds }: { planIds: RecordId[] }) =>
  Map.groupBy(
    await BudgetLineGroups.findAll({
      where: { planId: { [Op.in]: planIds } },
      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    }),
    (group) => group.planId,
  );

/** Ungrouped first, then groups in the given order. Meant for a stable sort over lines already in `sortOrder`. */
const groupRanker = ({ groups }: { groups: BudgetLineGroups[] }) => {
  const rank = new Map<string, number>(groups.map((group, index) => [group.id, index]));
  return (groupId: string | null): number => (groupId === null ? -1 : (rank.get(groupId) ?? -1));
};

export async function transformBudgetLines({ userId }: { userId: number }): Promise<BudgetLineRow[]> {
  const plans = await listPlans({ userId });
  if (plans.length === 0) return [];
  const planIds = plans.map((plan) => plan.id);

  const [lines, groupsByPlan, categories] = await Promise.all([
    BudgetLines.findAll({
      where: { planId: { [Op.in]: planIds } },
      order: [
        ['sortOrder', 'ASC'],
        ['id', 'ASC'],
      ],
    }),
    loadGroupsByPlan({ planIds }),
    Categories.findAll({ where: { userId }, attributes: ['id', 'name'] }),
  ]);
  if (lines.length === 0) return [];

  const lineIds = lines.map((line) => line.id);
  const [lineCategories, goals] = await Promise.all([
    BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
    BudgetLineGoals.findAll({ where: { lineId: { [Op.in]: lineIds } } }),
  ]);

  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const goalByLineId = new Map(goals.map((row) => [row.lineId, toGoalSpec({ row })]));
  const lineCategoriesByLine = Map.groupBy(lineCategories, (row) => row.lineId);
  const linesByPlan = Map.groupBy(lines, (line) => line.planId);
  const today = toUtcDateString(new Date());

  return plans.flatMap((plan) => {
    const groups = groupsByPlan.get(plan.id) ?? [];
    const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
    const rankOf = groupRanker({ groups });
    const currentStart = boundaryAtOrBefore({ plan, date: today });

    return (linesByPlan.get(plan.id) ?? [])
      .toSorted((a, b) => rankOf(a.groupId) - rankOf(b.groupId))
      .map((line): BudgetLineRow => {
        const archived = line.activeUntil !== null;
        const categoryIds = archived
          ? line.archivedCategoryIds
          : toLineEntry({ line, lineCategories: lineCategoriesByLine.get(line.id) ?? [], currentStart }).categoryIds;
        const goal = goalByLineId.get(line.id);
        const context = `budget line ${line.id}`;

        return {
          plan: plan.name,
          group: resolveRelationName({
            id: line.groupId,
            nameById: groupNameById,
            relation: 'budget line group',
            context,
          }),
          line: line.name,
          categories: categoryIds
            .map((id) => resolveRelationName({ id, nameById: categoryNameById, relation: 'category', context }))
            .toSorted(),
          archived,
          goal: goal ? goalText({ goal }) : '',
          currency: plan.currencyCode,
        };
      });
  });
}

/**
 * Every period from the plan's epoch through the later of the current one and
 * the last one holding an assignment row, so a future period's carry-in has
 * every period it depends on. Numbers come from the same fold the period view reads.
 */
export async function transformBudgetPeriods({
  userId,
  dateRange,
}: {
  userId: number;
  dateRange?: ExportDateRange;
}): Promise<BudgetPeriodRow[]> {
  const plans = await listPlans({ userId });
  if (plans.length === 0) return [];

  const groupsByPlan = await loadGroupsByPlan({ planIds: plans.map((plan) => plan.id) });
  const today = toUtcDateString(new Date());

  const rowsByPlan = await Promise.all(
    plans.map(async (plan) => {
      const input = await loadFoldInput({ plan, today });
      const assignedPeriodIds = new Set<string>(input.assignments.map((row) => row.periodId));
      const groupIdOf = new Map<string, string | null>(input.lines.map((line) => [line.id, line.groupId]));
      const rankOf = groupRanker({ groups: groupsByPlan.get(plan.id) ?? [] });
      const folded = foldPlan(input);
      const lastAssignedStart = folded.findLast(({ period }) => assignedPeriodIds.has(period.id))?.period.startDate;
      const keepThrough = lastAssignedStart && lastAssignedStart > today ? lastAssignedStart : today;

      return folded.flatMap(({ period, lines }) => {
        const periodEndInclusive = addUtcDays({ date: period.endDate, days: -1 });
        const kept =
          period.startDate <= keepThrough &&
          (!dateRange?.from || periodEndInclusive >= dateRange.from) &&
          (!dateRange?.to || period.startDate <= dateRange.to);
        if (!kept) return [];

        return lines
          .toSorted((a, b) => rankOf(groupIdOf.get(a.lineId) ?? null) - rankOf(groupIdOf.get(b.lineId) ?? null))
          .map(
            (line): BudgetPeriodRow => ({
              plan: plan.name,
              periodStart: period.startDate,
              periodEndInclusive,
              line: line.name,
              assigned: centsToApiDecimal(line.assigned),
              spent: centsToApiDecimal(-line.activity),
              available: centsToApiDecimal(line.available),
              currency: plan.currencyCode,
            }),
          );
      });
    }),
  );

  return rowsByPlan.flat();
}
