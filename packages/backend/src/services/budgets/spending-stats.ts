import type { RecordId } from '@bt/shared/types';
import { BUDGET_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Accounts from '@models/accounts.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import Tags from '@models/tags.model';
import TransactionSplits from '@models/transaction-splits.model';
import { PlannedPolicy, transactionsInclude } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { statsTransactions } from '@services/stats/stats-transactions';
import {
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  max,
  min,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { Op } from 'sequelize';

import { authorizeBudgetRead } from './authorize-budget-access';
import { buildDateFilter } from './utils/build-date-filter';
import { type BudgetRefundPair, fetchBudgetRefundPairs } from './utils/refund-pairs';

interface CategoryInfo {
  id: RecordId;
  name: string;
  color: string;
  parentId: RecordId | null;
}

interface SpendingByCategoryItem {
  categoryId: RecordId;
  name: string;
  color: string;
  amount: number; // cents, positive (expenses only)
  children?: SpendingByCategoryItem[];
}

interface CategoryAmountEntry {
  amount: number;
  children: Map<RecordId, number>;
}

interface SpendingPeriod {
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;
  expense: number; // cents, positive
  income: number; // cents, positive
}

interface SpendingStatsResponse {
  spendingsByCategory: SpendingByCategoryItem[];
  spendingOverTime: {
    granularity: 'monthly' | 'weekly';
    periods: SpendingPeriod[];
  };
}

type Granularity = 'monthly' | 'weekly';

const PERIOD_CONFIG = {
  monthly: {
    getStart: (date: Date) => startOfMonth(date),
    getEnd: (date: Date) => endOfMonth(date),
    advance: (date: Date) => addMonths(date, 1),
  },
  weekly: {
    getStart: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
    getEnd: (date: Date) => endOfWeek(date, { weekStartsOn: 1 }),
    advance: (date: Date) => addWeeks(date, 1),
  },
} as const;

const generatePeriodBuckets = ({
  from,
  to,
  granularity,
}: {
  from: Date;
  to: Date;
  granularity: Granularity;
}): { periodStart: Date; periodEnd: Date }[] => {
  const buckets: { periodStart: Date; periodEnd: Date }[] = [];
  const endDate = endOfDay(to);
  const { getStart, getEnd, advance } = PERIOD_CONFIG[granularity];

  let currentStart = getStart(from);
  while (isBefore(currentStart, endDate) || currentStart.getTime() === endDate.getTime()) {
    buckets.push({
      periodStart: max([currentStart, from]),
      periodEnd: min([getEnd(currentStart), endDate]),
    });
    currentStart = advance(currentStart);
  }

  return buckets;
};

const findBucketIndex = ({
  transactionTime,
  buckets,
}: {
  transactionTime: Date;
  buckets: { periodStart: Date; periodEnd: Date }[];
}): number => {
  const txTime = transactionTime.getTime();
  return buckets.findIndex((bucket) => txTime >= bucket.periodStart.getTime() && txTime <= bucket.periodEnd.getTime());
};

const getRootCategoryId = ({
  categoryId,
  categoryMap,
}: {
  categoryId: RecordId;
  categoryMap: Map<string, CategoryInfo>;
}): RecordId => {
  let current = categoryMap.get(categoryId);
  if (!current) return categoryId;

  while (current.parentId !== null) {
    const parent = categoryMap.get(current.parentId);
    if (!parent) break;
    current = parent;
  }

  return current.id;
};

/**
 * Walks up the category tree and returns the HIGHEST ancestor that is in
 * targetCategoryIds. Used for subcategory breakdown: when a budget contains
 * both a parent and its children, transactions under children aggregate to
 * the parent.
 */
const getTopLevelTargetCategoryId = ({
  categoryId,
  categoryMap,
  targetCategoryIds,
}: {
  categoryId: RecordId;
  categoryMap: Map<string, CategoryInfo>;
  targetCategoryIds: Set<RecordId>;
}): RecordId => {
  let topLevel = categoryId;
  let current = categoryMap.get(categoryId);

  while (current) {
    if (targetCategoryIds.has(current.id)) {
      topLevel = current.id;
    }
    if (current.parentId === null) break;
    current = categoryMap.get(current.parentId);
  }

  return topLevel;
};

const determineGranularity = ({ from, to }: { from: Date; to: Date }): Granularity => {
  const diffMs = to.getTime() - from.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= 60 ? 'weekly' : 'monthly';
};

const getEmptyResponse = (): SpendingStatsResponse => ({
  spendingsByCategory: [],
  spendingOverTime: {
    granularity: 'monthly',
    periods: [],
  },
});

const buildCategoryMap = ({
  categories,
}: {
  categories: { id: RecordId; name: string; color: string; parentId: RecordId | null }[];
}): Map<string, CategoryInfo> => {
  const categoryMap = new Map<string, CategoryInfo>();
  categories.forEach((cat) => {
    categoryMap.set(cat.id, {
      id: cat.id,
      name: cat.name,
      color: cat.color,
      parentId: cat.parentId,
    });
  });
  return categoryMap;
};

const buildSpendingOverTime = ({
  buckets,
  granularity,
  periodData,
}: {
  buckets: { periodStart: Date; periodEnd: Date }[];
  granularity: Granularity;
  periodData: Map<number, { expense: number; income: number }>;
}): SpendingStatsResponse['spendingOverTime'] => ({
  granularity,
  periods: buckets.map((bucket, index) => {
    const data = periodData.get(index) || { expense: 0, income: 0 };
    return {
      periodStart: format(bucket.periodStart, 'yyyy-MM-dd'),
      periodEnd: format(bucket.periodEnd, 'yyyy-MM-dd'),
      // Magnitudes: a bucket refunded past its own spend reports 0 rather than an inverted bar.
      expense: Math.max(0, data.expense),
      income: Math.max(0, data.income),
    };
  }),
});

const buildSpendingsByCategory = ({
  categoryAmounts,
  categoryMap,
}: {
  categoryAmounts: Map<RecordId, CategoryAmountEntry>;
  categoryMap: Map<string, CategoryInfo>;
}): SpendingByCategoryItem[] => {
  const result: SpendingByCategoryItem[] = [];
  for (const [catId, entry] of categoryAmounts) {
    // A category refunded past its own spend nets below zero; it carries no expense to report.
    if (entry.amount <= 0) continue;
    const catInfo = categoryMap.get(catId);

    const item: SpendingByCategoryItem = {
      categoryId: catId,
      name: catInfo?.name || 'Unknown',
      color: catInfo?.color || '#888888',
      amount: entry.amount,
    };

    if (entry.children.size > 0) {
      const children: SpendingByCategoryItem[] = [];
      for (const [childId, childAmount] of entry.children) {
        if (childAmount <= 0) continue;
        const childInfo = categoryMap.get(childId);
        children.push({
          categoryId: childId,
          name: childInfo?.name || 'Unknown',
          color: childInfo?.color || '#888888',
          amount: childAmount,
        });
      }
      children.sort((a, b) => b.amount - a.amount);
      item.children = children;
    }

    result.push(item);
  }
  result.sort((a, b) => b.amount - a.amount);
  return result;
};

interface NormalizedTxData {
  time: Date;
  amount: number; // cents
  isExpense: boolean;
  categoryId: RecordId | null; // aggregation target (root or top-level target), null = skip category aggregation
  originalCategoryId: RecordId | null; // the actual leaf category
  /** When true, subtract `amount` instead of adding. Used to net out refund pairs. */
  negative?: boolean;
}

const determineDateRange = ({
  budgetStartDate,
  budgetEndDate,
  transactionTimes,
}: {
  budgetStartDate: Date | null;
  budgetEndDate: Date | null;
  transactionTimes: Date[];
}): { from: Date; to: Date } => {
  if (budgetStartDate && budgetEndDate) {
    return { from: new Date(budgetStartDate), to: new Date(budgetEndDate) };
  }
  const timestamps = transactionTimes.map((time) => time.getTime());
  return {
    from: new Date(Math.min(...timestamps)),
    to: new Date(Math.max(...timestamps)),
  };
};

const aggregateTransactionData = ({
  txDataList,
  budgetStartDate,
  budgetEndDate,
  categoryMap,
}: {
  txDataList: NormalizedTxData[];
  budgetStartDate: Date | null;
  budgetEndDate: Date | null;
  categoryMap: Map<string, CategoryInfo>;
}): SpendingStatsResponse => {
  const { from: rangeFrom, to: rangeTo } = determineDateRange({
    budgetStartDate,
    budgetEndDate,
    transactionTimes: txDataList.map((d) => new Date(d.time)),
  });

  const granularity = determineGranularity({ from: rangeFrom, to: rangeTo });
  const buckets = generatePeriodBuckets({ from: rangeFrom, to: rangeTo, granularity });

  const periodData = new Map<number, { expense: number; income: number }>();
  buckets.forEach((_, index) => periodData.set(index, { expense: 0, income: 0 }));

  const categoryAmounts = new Map<RecordId, CategoryAmountEntry>();

  for (const txData of txDataList) {
    const sign = txData.negative ? -1 : 1;
    const signedAmount = txData.amount * sign;

    const bucketIndex = findBucketIndex({ transactionTime: new Date(txData.time), buckets });
    if (bucketIndex !== -1) {
      const period = periodData.get(bucketIndex)!;
      if (txData.isExpense) {
        period.expense += signedAmount;
      } else {
        period.income += signedAmount;
      }
    }

    if (txData.isExpense && txData.categoryId !== null) {
      // For refund subtractions, only adjust an existing bucket — never create a new
      // negative-amount entry for a category that wasn't part of the forward aggregation.
      if (txData.negative && !categoryAmounts.has(txData.categoryId)) continue;

      const entry = categoryAmounts.get(txData.categoryId) ?? { amount: 0, children: new Map() };
      entry.amount += signedAmount;
      if (txData.originalCategoryId !== null && txData.originalCategoryId !== txData.categoryId) {
        const existingChild = entry.children.get(txData.originalCategoryId);
        if (txData.negative) {
          // Same guard as above for the child bucket.
          if (existingChild !== undefined) {
            entry.children.set(txData.originalCategoryId, existingChild + signedAmount);
          }
        } else {
          entry.children.set(txData.originalCategoryId, (existingChild ?? 0) + signedAmount);
        }
      }
      categoryAmounts.set(txData.categoryId, entry);
    }
  }

  return {
    spendingsByCategory: buildSpendingsByCategory({ categoryAmounts, categoryMap }),
    spendingOverTime: buildSpendingOverTime({ buckets, granularity, periodData }),
  };
};

/**
 * Builds negative `NormalizedTxData` entries from refund pairs so `aggregateTransactionData`
 * nets them out of the period income/expense and per-category expense aggregations. For each
 * side of a pair that's in the budget, we subtract `refundTx.refAmount` — matching the global
 * "Expenses Structure" widget's refund handling.
 */
const buildRefundAdjustments = ({
  pairs,
  resolveCategoryBucket,
}: {
  pairs: BudgetRefundPair[];
  resolveCategoryBucket: (categoryId: RecordId) => RecordId | null;
}): NormalizedTxData[] => {
  const adjustments: NormalizedTxData[] = [];

  for (const pair of pairs) {
    const adjustmentAmount = pair.refundTx.refAmount.toCents();

    const pushSide = ({
      tx,
      overrideCategoryId,
    }: {
      tx: BudgetRefundPair['originalTx'];
      overrideCategoryId: RecordId | null;
    }) => {
      const isExpense = tx.transactionType === TRANSACTION_TYPES.expense;
      const targetCategoryId = overrideCategoryId ?? tx.categoryId;
      const resolved = isExpense ? resolveCategoryBucket(targetCategoryId) : null;
      adjustments.push({
        time: tx.time,
        amount: adjustmentAmount,
        isExpense,
        categoryId: resolved,
        originalCategoryId: isExpense ? targetCategoryId : null,
        negative: true,
      });
    };

    // splitId only applies to the original side — splits belong to the original tx.
    if (pair.originalInScope) pushSide({ tx: pair.originalTx, overrideCategoryId: pair.splitCategoryId });
    if (pair.refundInScope) pushSide({ tx: pair.refundTx, overrideCategoryId: null });
  }

  return adjustments;
};

/** Synthetic categoryId used to bucket recipients' null-key (custom) categories in the
 *  shared-budget spending breakdown. Owner-side customs stay as their own rows; only
 *  recipient-side null-key categories fold here, per the MVP decision (cross-user custom
 *  alignment is a deferred follow-up). Carries a unique non-UUID shape so it can't collide
 *  with a real `Categories.id`. Cast to `RecordId` so it slots into the existing maps
 *  without widening every signature to `string | RecordId`. */
const OTHER_CATEGORY_ID = '__shared_budget_other__' as RecordId;

/** Build a categoryId -> canonical categoryId map for shared-budget aggregation.
 *
 *  Strategy (per the "merge by Categories.key" decision):
 *    - Owner's category: maps to itself (no change).
 *    - Recipient's seeded category whose `key` matches an owner category: maps to the
 *      owner's matching id, so owner + recipient contributions land in the same bucket
 *      and the breakdown displays owner's name/color.
 *    - Recipient's seeded category whose `key` has no owner counterpart: maps to itself
 *      (rendered with the recipient's own name/color — uncommon since seeded keys are
 *      consistent across users by construction).
 *    - Recipient's null-key (custom) category: maps to `OTHER_CATEGORY_ID`. The breakdown
 *      shows a single "Other" row aggregating all such contributions.
 */
const buildSharedBudgetMergeMap = ({
  categories,
  ownerUserId,
}: {
  categories: { id: RecordId; key: string | null; userId: number }[];
  ownerUserId: number;
}): Map<RecordId, RecordId> => {
  const ownerKeyToId = new Map<string, RecordId>();
  for (const cat of categories) {
    if (cat.userId === ownerUserId && cat.key !== null) {
      ownerKeyToId.set(cat.key, cat.id);
    }
  }

  const mergeMap = new Map<RecordId, RecordId>();
  for (const cat of categories) {
    if (cat.userId === ownerUserId) {
      mergeMap.set(cat.id, cat.id);
    } else if (cat.key !== null && ownerKeyToId.has(cat.key)) {
      mergeMap.set(cat.id, ownerKeyToId.get(cat.key)!);
    } else if (cat.key === null) {
      mergeMap.set(cat.id, OTHER_CATEGORY_ID);
    } else {
      // Recipient seeded category with a key the owner doesn't have — render under the
      // recipient's own name/color rather than burying it in "Other".
      mergeMap.set(cat.id, cat.id);
    }
  }
  return mergeMap;
};

/**
 * Manual budget: fetch transactions via the BudgetTransactions junction (no userId
 * filter, so recipient contributions count) and group by root category.
 *
 * Shared-budget category breakdown merges by `Categories.key`: a recipient's seeded
 * category folds into the owner's matching one (display shows owner's name/color); a
 * recipient's custom (null-key) category buckets under a synthetic "Other" row. See
 * `buildSharedBudgetMergeMap` for the full strategy. For non-shared budgets, the merge
 * map is identity-only and behaviour matches the pre-share implementation.
 */
const getManualBudgetSpendingStats = async ({
  userId: ownerUserId,
  budgetId,
  callerUserId,
}: {
  userId: number;
  budgetId: string;
  callerUserId: number;
}): Promise<SpendingStatsResponse> => {
  const budgetDetails = await findOrThrowNotFound({
    query: Budgets.findOne({ where: { id: budgetId, userId: ownerUserId } }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const transactions = await Transactions.findWithFilters({
    excludeTransfer: true,
    budgetIds: [budgetId],
    completeness: 'all',
    planned: { visibleTo: callerUserId },
    access: 'pre-scoped',
    balanceAdjustments: 'include',
    attributes: ['id', 'time', 'refAmount', 'transactionType', 'categoryId', 'refundLinked', 'userId'],
  });

  if (transactions.length === 0) return getEmptyResponse();

  // Contributors = owner (always, even with no own tx) + every userId that authored a
  // tx attached to this budget. Owner's tree must be loaded so the merge map has key->id
  // targets to fold recipients into; recipient trees are loaded so the parent walk works.
  const contributingUserIds = new Set<number>([ownerUserId]);
  for (const tx of transactions) contributingUserIds.add(tx.userId);

  const allCategoriesRaw = (await Categories.findAll({
    where: { userId: { [Op.in]: Array.from(contributingUserIds) } },
    attributes: ['id', 'name', 'color', 'parentId', 'key', 'userId'],
    raw: true,
  })) as unknown as {
    id: RecordId;
    name: string;
    color: string;
    parentId: RecordId | null;
    key: string | null;
    userId: number;
  }[];

  const mergeMap = buildSharedBudgetMergeMap({ categories: allCategoriesRaw, ownerUserId });
  const canonicalize = (id: RecordId): RecordId => mergeMap.get(id) ?? id;

  const categoryMap = buildCategoryMap({ categories: allCategoriesRaw });
  categoryMap.set(OTHER_CATEGORY_ID, {
    id: OTHER_CATEGORY_ID,
    name: 'Other',
    color: '#6B7280',
    parentId: null,
  });

  const canonicalChildId = (id: RecordId | null): RecordId | null => {
    if (id === null) return null;
    const canonical = canonicalize(id);
    // Recipient's null-key custom categories collapse to `OTHER` at the canonical
    // step. Returning `null` here keeps them out of the child-row breakdown — they
    // would otherwise render as an "Other" subcategory under a (possibly keyed)
    // parent, which would be confusing alongside a top-level "Other" row.
    return canonical === OTHER_CATEGORY_ID ? null : canonical;
  };

  const txDataList: NormalizedTxData[] = transactions.map((tx) => {
    const rootCatId = tx.categoryId
      ? canonicalize(getRootCategoryId({ categoryId: tx.categoryId, categoryMap }))
      : null;
    return {
      time: tx.time,
      amount: tx.refAmount.toCents(),
      isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
      categoryId: rootCatId,
      // Apply the merge map to the child id too — otherwise we'd render duplicate
      // "Groceries" rows under "Food" (one each for owner's and recipient's
      // categoryId, both meaning the same thing).
      originalCategoryId: canonicalChildId(tx.categoryId),
    };
  });

  const refundPairs = await fetchBudgetRefundPairs({ countedTransactions: transactions });
  const refundAdjustments = buildRefundAdjustments({
    pairs: refundPairs,
    resolveCategoryBucket: (categoryId) => canonicalize(getRootCategoryId({ categoryId, categoryMap })),
  });

  return aggregateTransactionData({
    txDataList: [...txDataList, ...refundAdjustments],
    budgetStartDate: budgetDetails.startDate,
    budgetEndDate: budgetDetails.endDate,
    categoryMap,
  });
};

/**
 * Category budget: fetch transactions by category IDs, handle splits
 */
const getCategoryBudgetSpendingStats = async ({
  userId,
  budgetId,
  isOwner,
}: {
  userId: number;
  budgetId: string;
  isOwner: boolean;
}): Promise<SpendingStatsResponse> => {
  const budgetDetails = await findOrThrowNotFound({
    query: Budgets.findOne({
      where: { id: budgetId, userId },
      include: [{ model: Categories, as: 'categories', attributes: ['id'] }],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const budgetCategoryIds = budgetDetails.categories?.map((c) => c.id) || [];

  if (!budgetCategoryIds.length) return getEmptyResponse();

  const dateFilter = buildDateFilter({
    startDate: budgetDetails.startDate,
    endDate: budgetDetails.endDate,
  });

  // Fetch all user categories for hierarchy
  const allCategoriesRaw = (await Categories.findAll({
    where: { userId },
    attributes: ['id', 'name', 'color', 'parentId'],
    raw: true,
  })) as unknown as { id: RecordId; name: string; color: string; parentId: RecordId | null }[];
  const categoryMap = buildCategoryMap({ categories: allCategoriesRaw });
  const targetCategoryIds = new Set<RecordId>(budgetCategoryIds);

  // Expand target categories to include all descendants
  const expandedCategoryIds = new Set<RecordId>(budgetCategoryIds);
  allCategoriesRaw.forEach((cat) => {
    let current: CategoryInfo | undefined = categoryMap.get(cat.id);
    while (current) {
      if (targetCategoryIds.has(current.id)) {
        expandedCategoryIds.add(cat.id);
        break;
      }
      if (current.parentId === null) break;
      current = categoryMap.get(current.parentId);
    }
  });

  // Planned rows are owner-only: they count as spent for the owner, but a share
  // recipient must never see them.
  const planned: PlannedPolicy = isOwner ? 'include' : 'exclude';

  // Primary category transactions (without splits)
  const { rows: primaryCategoryTransactions } = await statsTransactions({
    access: { creator: userId },
    planned,
    refunds: 'ignore',
    window: { from: budgetDetails.startDate ?? undefined, to: budgetDetails.endDate ?? undefined },
    where: { categoryId: { [Op.in]: Array.from(expandedCategoryIds) } },
    include: [{ model: TransactionSplits, as: 'splits', required: false }],
  });

  // Matching splits
  const matchingSplits = await TransactionSplits.findAll({
    where: {
      userId,
      categoryId: { [Op.in]: Array.from(expandedCategoryIds) },
    },
    include: [
      transactionsInclude({
        planned,
        required: true,
        as: 'transaction',
        where: {
          transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
          ...dateFilter,
        },
        attributes: ['id', 'time', 'transactionType', 'refundLinked'],
        include: [{ model: Accounts, where: { excludeFromStats: false }, attributes: [] }],
      }),
    ],
  });

  const txDataList: NormalizedTxData[] = [];
  const countedTransactions: { id: string; refundLinked: boolean }[] = [];

  // Process primary category transactions (only those WITHOUT splits)
  for (const tx of primaryCategoryTransactions) {
    const splits = tx.get('splits') as TransactionSplits[] | undefined;
    if (splits && splits.length > 0) continue;

    const topLevelCatId = getTopLevelTargetCategoryId({
      categoryId: tx.categoryId!,
      categoryMap,
      targetCategoryIds,
    });

    txDataList.push({
      time: tx.time,
      amount: tx.refAmount.toCents(),
      isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
      categoryId: topLevelCatId,
      originalCategoryId: tx.categoryId!,
    });
    countedTransactions.push({ id: tx.id, refundLinked: tx.refundLinked });
  }

  // Process splits
  for (const split of matchingSplits) {
    const transaction = split.get('transaction') as Transactions.default;
    if (!transaction) continue;

    const topLevelCatId = getTopLevelTargetCategoryId({
      categoryId: split.categoryId,
      categoryMap,
      targetCategoryIds,
    });

    txDataList.push({
      time: transaction.time,
      amount: split.refAmount.toCents(),
      isExpense: transaction.transactionType === TRANSACTION_TYPES.expense,
      categoryId: topLevelCatId,
      originalCategoryId: split.categoryId,
    });
    countedTransactions.push({ id: transaction.id, refundLinked: transaction.refundLinked });
  }

  if (txDataList.length === 0) return getEmptyResponse();

  const refundPairs = await fetchBudgetRefundPairs({ countedTransactions });
  const refundAdjustments = buildRefundAdjustments({
    pairs: refundPairs,
    resolveCategoryBucket: (categoryId) => getTopLevelTargetCategoryId({ categoryId, categoryMap, targetCategoryIds }),
  });

  return aggregateTransactionData({
    txDataList: [...txDataList, ...refundAdjustments],
    budgetStartDate: budgetDetails.startDate,
    budgetEndDate: budgetDetails.endDate,
    categoryMap,
  });
};

/**
 * Tag budget: fetch transactions by linked tag IDs (OR-matched, same as `stats.ts`'s
 * `getTagBudgetStats`) and roll up to root category — mirroring the manual budget's
 * root-category rollup rather than the category budget's target-category walk, since
 * a tag has no fixed category set of its own; every category its transactions land in
 * is relevant. Owner-scoped only (no cross-user merge map): like category budgets,
 * tag budgets don't accept recipient-attached transactions, so only the owner's own
 * category tree is ever in play.
 */
const getTagBudgetSpendingStats = async ({
  userId,
  budgetId,
  isOwner,
}: {
  userId: number;
  budgetId: string;
  isOwner: boolean;
}): Promise<SpendingStatsResponse> => {
  const budgetDetails = await findOrThrowNotFound({
    query: Budgets.findOne({
      where: { id: budgetId, userId },
      include: [{ model: Tags, as: 'tags', attributes: ['id'] }],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const tagIds = budgetDetails.tags?.map((tag) => tag.id) || [];

  if (!tagIds.length) return getEmptyResponse();

  // Planned rows are owner-only: they count as spent for the owner, but a share
  // recipient must never see them.
  const planned: PlannedPolicy = isOwner ? 'include' : 'exclude';

  const transactions = await Transactions.findWithFilters({
    excludeTransfer: true,
    tagIds,
    completeness: 'all',
    planned,
    access: { creator: userId },
    balanceAdjustments: 'include',
    startDate: budgetDetails.startDate ? budgetDetails.startDate.toISOString() : undefined,
    endDate: budgetDetails.endDate ? budgetDetails.endDate.toISOString() : undefined,
    attributes: ['id', 'time', 'refAmount', 'transactionType', 'categoryId', 'refundLinked'],
  });

  if (transactions.length === 0) return getEmptyResponse();

  const allCategoriesRaw = (await Categories.findAll({
    where: { userId },
    attributes: ['id', 'name', 'color', 'parentId'],
    raw: true,
  })) as unknown as { id: RecordId; name: string; color: string; parentId: RecordId | null }[];
  const categoryMap = buildCategoryMap({ categories: allCategoriesRaw });

  const txDataList: NormalizedTxData[] = transactions.map((tx) => ({
    time: tx.time,
    amount: tx.refAmount.toCents(),
    isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
    categoryId: tx.categoryId ? getRootCategoryId({ categoryId: tx.categoryId, categoryMap }) : null,
    originalCategoryId: tx.categoryId,
  }));

  const countedTransactions = transactions.map((tx) => ({ id: tx.id, refundLinked: tx.refundLinked }));
  const refundPairs = await fetchBudgetRefundPairs({ countedTransactions });
  const refundAdjustments = buildRefundAdjustments({
    pairs: refundPairs,
    resolveCategoryBucket: (categoryId) => getRootCategoryId({ categoryId, categoryMap }),
  });

  return aggregateTransactionData({
    txDataList: [...txDataList, ...refundAdjustments],
    budgetStartDate: budgetDetails.startDate,
    budgetEndDate: budgetDetails.endDate,
    categoryMap,
  });
};

export const getBudgetSpendingStats = async ({
  userId,
  budgetId,
}: {
  userId: number;
  budgetId: string;
}): Promise<SpendingStatsResponse> => {
  // Share-aware auth: recipient sees the same numbers the owner would (per PRD
  // visibility decision). Downstream queries scope against the owner's userId so
  // a recipient's unrelated transactions don't filter the result.
  const { ownerUserId, isOwner } = await authorizeBudgetRead({ userId, budgetId });

  const budgetDetails = await findOrThrowNotFound({
    query: Budgets.findOne({ where: { id: budgetId, userId: ownerUserId }, attributes: ['type'] }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  if (budgetDetails.type === BUDGET_TYPES.category) {
    return getCategoryBudgetSpendingStats({ userId: ownerUserId, budgetId, isOwner });
  }

  if (budgetDetails.type === BUDGET_TYPES.tag) {
    return getTagBudgetSpendingStats({ userId: ownerUserId, budgetId, isOwner });
  }

  return getManualBudgetSpendingStats({ userId: ownerUserId, budgetId, callerUserId: userId });
};
