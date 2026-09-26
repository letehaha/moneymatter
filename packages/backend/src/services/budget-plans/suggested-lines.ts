import { RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { AddSuggestedBudgetLinesResponse, BudgetPlanCadence } from '@bt/shared/types/budget-plans';
import { requestContext } from '@common/request-context';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';
import { t } from '@i18n/index';
import BudgetAssignments from '@models/budget-assignments.model';
import BudgetLineCategories from '@models/budget-line-categories.model';
import BudgetLineGroups from '@models/budget-line-groups.model';
import BudgetLines from '@models/budget-lines.model';
import BudgetPlanAccounts from '@models/budget-plan-accounts.model';
import BudgetPlans from '@models/budget-plans.model';
import Categories from '@models/categories.model';
import {
  expandCategoryIdsWithDescendants,
  getAncestorIds,
  getRootCategoryId,
} from '@services/categories/category-hierarchy';
import { withTransaction } from '@services/common/with-transaction';
import { getSpendingsByCategories } from '@services/stats/get-spendings-by-categories';
import { Op } from 'sequelize';

import { createLine } from './create-line';
import { DateRange, clipRange, rangesIntersect, toRange } from './date-ranges';
import { findPlan } from './find-plan';
import { createGroup } from './line-groups';
import { ensureCurrentPeriods } from './periods/ensure-periods';

const MAX_LINES = 8;
const HISTORY_MONTHS = 3;
const ROUND_UP_TO_CENTS = 1000;

const GROUPS = ['bills', 'everyday', 'life'] as const;
type SuggestedGroup = (typeof GROUPS)[number];

const GROUP_BY_ROOT_KEY: Record<string, SuggestedGroup> = {
  housing: 'bills',
  communication: 'bills',
  'financial-expenses': 'bills',
  food: 'everyday',
  transportation: 'everyday',
  vehicle: 'everyday',
  shopping: 'everyday',
  life: 'life',
  investments: 'life',
};
const EXCLUDED_ROOT_KEYS = new Set(['income', 'other']);

/** Keys repeat across parents (`lottery-gambling`), so entries match on the parent key too. */
const STARTER_TEMPLATE: { parentKey: string | null; key: string; group: SuggestedGroup }[] = [
  { parentKey: 'housing', key: 'rent', group: 'bills' },
  { parentKey: 'housing', key: 'energy-utilities', group: 'bills' },
  { parentKey: 'communication', key: 'phone-cell-phone', group: 'bills' },
  { parentKey: 'food', key: 'groceries', group: 'everyday' },
  { parentKey: 'food', key: 'restaurant', group: 'everyday' },
  { parentKey: null, key: 'transportation', group: 'everyday' },
  { parentKey: 'life', key: 'health-care-doctor', group: 'life' },
  { parentKey: 'shopping', key: 'free-time', group: 'life' },
];

interface Suggestion {
  category: Categories;
  group: SuggestedGroup | null;
  /** Spend filed directly on the category over the history window; ranks suggestions. */
  totalCents: number;
}

/** The categories other lines hold over any part of `range`, archived lines included. */
const ownedCategoryIds = async ({ planId, range }: { planId: RecordId; range: DateRange }): Promise<RecordId[]> => {
  const lines = await BudgetLines.findAll({ where: { planId } });
  if (!lines.length) return [];

  const lifetimes = new Map(
    lines.map((line) => [line.id, toRange({ from: line.activeFrom, until: line.activeUntil })]),
  );
  const rows = await BudgetLineCategories.findAll({ where: { lineId: { [Op.in]: lines.map((line) => line.id) } } });

  return rows
    .filter((row) => {
      const clipped = clipRange({
        range: toRange({ from: row.fromDate, until: row.untilDate }),
        bounds: lifetimes.get(row.lineId)!,
      });
      return clipped !== null && rangesIntersect({ a: clipped, b: range });
    })
    .map((row) => row.categoryId);
};

/** Expense cents per exact category over the full calendar months before the current one (UTC). */
const historySpend = async ({ plan, categories }: { plan: BudgetPlans; categories: Categories[] }) => {
  const accountIds = (await BudgetPlanAccounts.findAll({ where: { planId: plan.id }, attributes: ['accountId'] })).map(
    (row) => row.accountId,
  );
  // An empty `accountIds` would widen the stats scope to every account.
  if (!accountIds.length) return {};

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return getSpendingsByCategories({
    userId: plan.userId,
    from: toUtcDateString(new Date(Date.UTC(year, month - HISTORY_MONTHS, 1))),
    to: toUtcDateString(new Date(Date.UTC(year, month, 0))),
    accountIds,
    // Selecting every category keeps each total on its own category instead of the root.
    categoryIds: categories.map((category) => category.id),
    transactionType: TRANSACTION_TYPES.expense,
    excludePlanned: true,
  });
};

/** Monthly average in the plan's cadence, rounded up to a whole 10. Integer math keeps the ceil exact. */
const baselineCents = ({ plan, totalCents }: { plan: BudgetPlans; totalCents: number }): number => {
  const monthsPerPeriod: Record<BudgetPlanCadence, [number, number]> = {
    months: [plan.intervalN, 1],
    semi_monthly: [1, 2],
    days: [plan.intervalN * 12, 365],
  };
  const [numerator, denominator] = monthsPerPeriod[plan.cadence];

  return Math.ceil((totalCents * numerator) / (HISTORY_MONTHS * denominator * ROUND_UP_TO_CENTS)) * ROUND_UP_TO_CENTS;
};

const resolveGroupIds = async ({
  userId,
  planId,
  groups,
}: {
  userId: number;
  planId: RecordId;
  groups: Set<SuggestedGroup>;
}): Promise<Map<SuggestedGroup, RecordId>> => {
  const locale = requestContext.getLocale();
  const ids = new Map<SuggestedGroup, RecordId>();

  for (const group of GROUPS.filter((entry) => groups.has(entry))) {
    const name = t({ key: `budgetPlans.suggestedGroups.${group}`, locale });
    const existing = await BudgetLineGroups.findOne({ where: { planId, name } });
    ids.set(group, existing?.id ?? (await createGroup({ userId, planId, name })).id);
  }

  return ids;
};

/**
 * Lines for the plan's top spending categories, or a starter set when there is
 * no spending history. Categories another line already covers, directly or
 * through an ancestor or descendant, are skipped.
 */
const addSuggestedLinesImpl = async ({
  userId,
  planId,
}: {
  userId: number;
  planId: RecordId;
}): Promise<AddSuggestedBudgetLinesResponse> => {
  const plan = await findPlan({ planId, userId, lock: true });
  const { periods, currentStart } = await ensureCurrentPeriods({ plan });

  const categories = await Categories.findAll({ where: { userId }, attributes: ['id', 'parentId', 'key', 'name'] });
  const byId = new Map<string, Categories>(categories.map((category) => [category.id, category]));

  const taken = new Set<string>();
  const takenAncestors = new Set<string>();
  const take = ({ categoryId }: { categoryId: string }) => {
    taken.add(categoryId);
    for (const ancestorId of getAncestorIds({ categoryId, byId })) takenAncestors.add(ancestorId);
  };
  const overlaps = ({ categoryId }: { categoryId: string }) =>
    taken.has(categoryId) ||
    takenAncestors.has(categoryId) ||
    getAncestorIds({ categoryId, byId }).some((ancestorId) => taken.has(ancestorId));

  for (const categoryId of await ownedCategoryIds({ planId: plan.id, range: { from: currentStart, until: null } })) {
    take({ categoryId });
  }

  const spend = await historySpend({ plan, categories });
  const history: Suggestion[] = Object.entries(spend)
    .flatMap(([categoryId, { amount }]) => {
      const category = byId.get(categoryId)!;
      const rootKey = byId.get(getRootCategoryId({ categoryId, byId }))!.key ?? '';
      if (amount <= 0 || EXCLUDED_ROOT_KEYS.has(rootKey)) return [];
      return [{ category, totalCents: amount, group: GROUP_BY_ROOT_KEY[rootKey] ?? null }];
    })
    .toSorted((a, b) => b.totalCents - a.totalCents);

  const template: Suggestion[] = STARTER_TEMPLATE.flatMap(({ parentKey, key, group }) => {
    const category = categories.find(
      (entry) =>
        entry.key === key &&
        (parentKey === null ? entry.parentId === null : byId.get(entry.parentId ?? '')?.key === parentKey),
    );
    return category ? [{ category, group, totalCents: 0 }] : [];
  });

  const picks: Suggestion[] = [];
  for (const suggestion of history.length ? history : template) {
    if (picks.length === MAX_LINES) break;
    if (overlaps({ categoryId: suggestion.category.id })) continue;

    take({ categoryId: suggestion.category.id });
    picks.push(suggestion);
  }
  if (!picks.length) return { created: 0 };

  // A line covers its category's whole subtree, and no pick has a taken descendant.
  const subtreeCents = ({ categoryId }: { categoryId: string }) =>
    expandCategoryIdsWithDescendants({ categoryIds: [categoryId], categories, byId }).reduce(
      (sum, id) => sum + Math.max(spend[id]?.amount ?? 0, 0),
      0,
    );

  const groupIds = await resolveGroupIds({
    userId,
    planId: plan.id,
    groups: new Set(picks.flatMap(({ group }) => (group ? [group] : []))),
  });
  const currentPeriod = periods.find((period) => toUtcDateString(period.startDate) === currentStart)!;

  for (const { category, group } of picks) {
    const line = await createLine({
      userId,
      planId: plan.id,
      name: category.name,
      categoryIds: [category.id],
      groupId: group ? groupIds.get(group)! : null,
    });

    const cents = baselineCents({ plan, totalCents: subtreeCents({ categoryId: category.id }) });
    if (cents > 0) {
      await BudgetAssignments.create({
        periodId: currentPeriod.id,
        lineId: line.id,
        baselineAmount: Money.fromCents(cents),
      });
    }
  }

  return { created: picks.length };
};

export const addSuggestedLines = withTransaction(addSuggestedLinesImpl);
