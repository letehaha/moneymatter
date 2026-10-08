import {
  type CashFlowGranularity,
  type CashFlowPeriodData,
  type GetCashFlowResponse,
  type RecordId,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { expandCategoryIdsWithDescendants, getRootCategoryId } from '@services/categories/category-hierarchy';
import {
  AccessibleCategoryInfo,
  getAccessibleCategoryMap,
} from '@services/categories/get-accessible-category-map.service';
import { withTransaction } from '@services/common/with-transaction';
import { type StatsScopeFilters, buildStatsScopeWhere } from '@services/stats/stats-scope-filters';
import { statsTransactions } from '@services/stats/stats-transactions';
import { getUserSettings } from '@services/user-settings/get-user-settings';
import { format } from 'date-fns';
import { Op } from 'sequelize';

import { computeCategoryAllocations } from './category-allocation';
import { findBucketIndex, generatePeriodBuckets } from './utils';

interface GetCashFlowParams extends StatsScopeFilters {
  userId: number;
  from: string;
  to: string;
  granularity: CashFlowGranularity;
  categoryIds?: RecordId[];
  /**
   * Categories the caller has hidden. Expanded to descendants here, because the list is a snapshot
   * saved in the widget config: a subcategory added after that save is still part of its hidden
   * parent.
   */
  excludedCategoryIds?: RecordId[];
  /** Drops pending planned rows, leaving only money that actually moved. */
  excludePlanned?: boolean;
}

type CategoryInfo = AccessibleCategoryInfo;

interface CategoryAmounts {
  incomeAmount: number;
  expenseAmount: number;
}

interface PeriodCategoryData {
  income: number;
  expenses: number;
  categories: Map<string, CategoryAmounts>; // categoryId -> amounts by type (aggregated by target category)
}

/**
 * Resolves the category a leg is reported under.
 *
 * With `targetCategoryIds` the closest selected ancestor (or the category itself) wins, and null
 * means the category sits outside the selection — a split can point anywhere, so this is the same
 * "no selected ancestor" answer the expenses-structure report uses to drop such legs.
 * Without a selection everything rolls up to its root category.
 */
const getAggregationCategoryId = ({
  categoryId,
  categoryMap,
  targetCategoryIds,
}: {
  categoryId: string;
  categoryMap: Map<string, CategoryInfo>;
  targetCategoryIds?: Set<string>;
}): string | null => {
  // If no target categories specified, aggregate to root
  if (!targetCategoryIds) {
    return getRootCategoryId({ categoryId, byId: categoryMap });
  }

  // If this category is itself a target, use it
  if (targetCategoryIds.has(categoryId)) {
    return categoryId;
  }

  // Walk up the hierarchy to find an ancestor that's a target
  let current = categoryMap.get(categoryId);
  while (current) {
    if (targetCategoryIds.has(current.id)) {
      return current.id;
    }
    if (current.parentId === null) break;
    current = categoryMap.get(current.parentId);
  }

  return null;
};

/**
 * Fetches cash flow data (income vs expenses) for a specified user within a date range,
 * aggregated by the specified granularity.
 *
 * Spend is routed through the shared category-allocation engine, so split transactions land on
 * their own categories and a refund reduces the side it reverses instead of inflating the other
 * one — the same numbers the expenses-structure and pivot reports show. Both halves of a refund
 * pair are subtracted in the same bucket, so netting never moves a period's net cash.
 *
 * Wrapped in a transaction so the category-map and transaction reads share one
 * pinned Postgres connection instead of a pool checkout per query — checkouts
 * from a drained pool trigger slow physical `pg.connect` mid-request.
 */
export const getCashFlow = withTransaction(
  async ({
    userId,
    from,
    to,
    granularity,
    accountId,
    accountIds,
    payeeIds,
    excludedPayeeIds,
    tagIds,
    excludedTagIds,
    categoryIds,
    excludedCategoryIds,
    excludePlanned,
  }: GetCashFlowParams): Promise<GetCashFlowResponse> => {
    // Generate period buckets
    const buckets = generatePeriodBuckets({ from, to, granularity });

    // Initialize period data
    const periodDataMap: Map<number, PeriodCategoryData> = new Map();
    buckets.forEach((_, index) => {
      periodDataMap.set(index, { income: 0, expenses: 0, categories: new Map() });
    });

    // Fetch categories for every owner whose accounts the caller can see (own + shared) so
    // shared-account transactions — which reference the owner's categoryId — render with
    // their real name/color instead of falling out of the hierarchy map.
    const { categories: allCategories, byId: categoryMap } = await getAccessibleCategoryMap({ userId });

    // Get root categories (those without a parent)
    const rootCategories = allCategories.filter((cat) => cat.parentId === null);

    // Determine which category IDs to filter by in the query
    let queryFilterCategoryIds: string[] | undefined;

    if (categoryIds && categoryIds.length > 0) {
      // User selected specific categories - expand to include all descendants so selecting a
      // parent also matches transactions filed directly under its subcategories.
      queryFilterCategoryIds = expandCategoryIdsWithDescendants({
        categoryIds,
        categories: allCategories,
        byId: categoryMap,
      });
    }

    // Build where clause for categories
    const categoryWhere =
      queryFilterCategoryIds && queryFilterCategoryIds.length > 0 ? { [Op.in]: queryFilterCategoryIds } : undefined;

    // Fetch all transactions (both income and expense) in the date range. Refund pairs come
    // resolved because this report nets them against income as well as expenses.
    const { rows: transactions, refundPairs } = await statsTransactions({
      access: { accessibleTo: userId },
      // `{ visibleTo }` rather than `'include'`: once the row scope spans a shared
      // account, `'include'` would count the other members' plans as this caller's
      // forecast. A plan is an intention of whoever recorded it.
      planned: excludePlanned ? 'exclude' : { visibleTo: userId },
      refunds: 'net',
      window: { from, to },
      where: {
        [Op.and]: [
          {
            transactionType: {
              [Op.in]: [TRANSACTION_TYPES.income, TRANSACTION_TYPES.expense],
            },
            ...(categoryWhere ? { categoryId: categoryWhere } : {}),
          },
          ...buildStatsScopeWhere({ accountId, accountIds, payeeIds, excludedPayeeIds, tagIds, excludedTagIds }),
        ],
      },
      attributes: ['id', 'time', 'refAmount', 'transactionType', 'categoryId', 'refundLinked'],
    });

    // Each leg carries its transaction's type, so one call covers both directions.
    const allocations = await computeCategoryAllocations({ transactions, applyRefunds: false });

    // Determine which categories to report in the breakdown
    // If specific categories selected, report those exact categories (not aggregated to root)
    // Otherwise, aggregate to root categories
    let reportCategoryIds: RecordId[];
    // When specific categories are selected, aggregate to those categories instead of root
    const aggregateToSelectedCategories = categoryIds && categoryIds.length > 0;

    if (aggregateToSelectedCategories) {
      // Report the exact categories the user selected
      reportCategoryIds = categoryIds;
    } else {
      // Use all root categories
      reportCategoryIds = rootCategories.map((cat) => cat.id);
    }

    // Create a set of target categories for aggregation (when specific categories are selected)
    const targetCategoryIds = aggregateToSelectedCategories ? new Set<string>(categoryIds) : undefined;

    // Categories the user counts as savings drop out of the report the same way an explicitly
    // excluded one does: money moved there is saved rather than spent, so it must not lower netFlow.
    const { savingsCategoryIds } = await getUserSettings({ userId });
    const hiddenCategoryIds = [...(excludedCategoryIds ?? []), ...(savingsCategoryIds ?? [])];

    // Hiding a parent hides everything under it, including subcategories created after the caller
    // saved the exclusion list.
    const excludedCategoryIdSet = new Set<string>(
      hiddenCategoryIds.length > 0
        ? expandCategoryIdsWithDescendants({
            categoryIds: hiddenCategoryIds,
            categories: allCategories,
            byId: categoryMap,
          })
        : [],
    );

    /**
     * Folds one signed contribution into its time bucket, both into the period total and — when
     * the leg carries a category — into the breakdown. Legs outside every bucket are dropped.
     *
     * When specific categories are selected the breakdown aggregates to those; otherwise to roots.
     */
    const applyLeg = ({
      categoryId,
      cents,
      time,
      isExpense,
    }: {
      categoryId: string | null;
      cents: number;
      time: Date;
      isExpense: boolean;
    }): void => {
      // An excluded leg leaves the period totals as well as the breakdown, so the widget's headline
      // income/expenses match the bars underneath. Filtering here rather than in the query keeps a
      // split whose own category is still counted, and never touches uncategorized legs.
      if (categoryId && excludedCategoryIdSet.has(categoryId)) return;

      // A split can point at a category the caller filtered out. Such a leg leaves the totals too,
      // so they stay equal to the sum of the reported categories.
      const aggregationCategoryId = categoryId
        ? getAggregationCategoryId({ categoryId, categoryMap, targetCategoryIds })
        : null;
      if (categoryId && aggregationCategoryId === null) return;

      const bucketIndex = findBucketIndex({ transactionTime: time, buckets });
      if (bucketIndex === -1) return;

      const periodData = periodDataMap.get(bucketIndex)!;
      if (isExpense) {
        periodData.expenses += cents;
      } else {
        periodData.income += cents;
      }

      if (!aggregationCategoryId) return;

      const currentAmounts = periodData.categories.get(aggregationCategoryId) || {
        incomeAmount: 0,
        expenseAmount: 0,
      };

      if (isExpense) {
        currentAmounts.expenseAmount += cents;
      } else {
        currentAmounts.incomeAmount += cents;
      }

      periodData.categories.set(aggregationCategoryId, currentAmounts);
    };

    for (const leg of allocations.base) {
      applyLeg({
        categoryId: leg.categoryId,
        cents: leg.cents,
        time: leg.time,
        isExpense: leg.transactionType === TRANSACTION_TYPES.expense,
      });
    }

    for (const pair of refundPairs) {
      // Netting needs both halves of the pair inside this report's scope. When an account, category
      // or date filter admits only one of them, subtracting that half alone would take away money
      // the other half never contributed — the range/filter simply keeps both sides gross instead.
      if (!pair.expenseInScope || !pair.incomeInScope) continue;

      // Both halves land in the refund's own bucket, so the period keeps the net cash it saw while
      // the money stops counting as spend on one side and as income on the other.
      applyLeg({ categoryId: pair.expenseCategoryId, cents: -pair.cents, time: pair.time, isExpense: true });
      applyLeg({ categoryId: pair.incomeCategoryId, cents: -pair.cents, time: pair.time, isExpense: false });
    }

    // Every period reports the same category set (stacked bars need a stable series list), so the
    // "has data somewhere" scan runs once rather than once per period.
    const categoriesWithData = reportCategoryIds.filter((catId) => {
      for (const [, periodData] of periodDataMap) {
        const amounts = periodData.categories.get(catId);
        if (amounts && (amounts.incomeAmount !== 0 || amounts.expenseAmount !== 0)) {
          return true;
        }
      }
      return false;
    });

    // Build response periods
    const periods: CashFlowPeriodData[] = buckets.map((bucket, index) => {
      const data = periodDataMap.get(index)!;

      const period: CashFlowPeriodData = {
        periodStart: format(bucket.periodStart, 'yyyy-MM-dd'),
        periodEnd: format(bucket.periodEnd, 'yyyy-MM-dd'),
        income: data.income,
        expenses: data.expenses,
        netFlow: data.income - data.expenses,
      };

      period.categories = categoriesWithData.map((catId) => {
        const catInfo = categoryMap.get(catId) || { name: 'Unknown', color: '#888888' };
        const amounts = data.categories.get(catId) || { incomeAmount: 0, expenseAmount: 0 };
        return {
          categoryId: catId,
          name: catInfo.name,
          color: catInfo.color,
          incomeAmount: amounts.incomeAmount,
          expenseAmount: amounts.expenseAmount,
        };
      });

      return period;
    });

    // Calculate totals
    const totals = periods.reduce(
      (acc, period) => {
        acc.income += period.income;
        acc.expenses += period.expenses;
        acc.netFlow += period.netFlow;
        return acc;
      },
      { income: 0, expenses: 0, netFlow: 0, savingsRate: 0 },
    );

    // Calculate savings rate (percentage of income saved)
    // If no income, savings rate is 0 (or could be negative infinity, but we'll use 0)
    totals.savingsRate = totals.income > 0 ? Math.round((totals.netFlow / totals.income) * 100) : 0;

    return { periods, totals };
  },
);
