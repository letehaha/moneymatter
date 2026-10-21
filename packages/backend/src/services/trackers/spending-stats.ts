import type { TrackerSpendingGranularity, EntityLogoFields, RecordId } from '@bt/shared/types';
import { TRACKER_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { getBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Payees from '@models/payees.model';
import Trackers from '@models/trackers.model';
import TransactionSplits from '@models/transaction-splits.model';
import { PlannedPolicy, transactionsInclude } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { EMPTY_LOGO_FIELDS, serializeLogoFields } from '@root/serializers/logo-fields.serializer';
import { statsTransactions } from '@services/stats/stats-transactions';
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  max,
  min,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { Op } from 'sequelize';

import { authorizeTrackerRead } from './authorize-tracker-access';
import { buildDateFilter } from './utils/build-date-filter';
import { type TrackerRefundPair, fetchTrackerRefundPairs } from './utils/refund-pairs';
import { OTHER_CATEGORY_ID, buildSharedTrackerMergeMap } from './utils/shared-category-merge-map';

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
  amount: number; // minor units, positive (expenses only)
  children?: SpendingByCategoryItem[];
}

interface CategoryAmountEntry {
  amount: number;
  children: Map<RecordId, number>;
}

interface SpendingPeriod {
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;
  expense: number; // minor units, positive
  income: number; // minor units, positive
}

interface SpendingByCurrencyItem {
  currencyCode: string;
  amount: Money; // in currencyCode, positive
  refAmount: number; // minor units, positive
}

interface SpendingPayeeItem extends EntityLogoFields {
  payeeId: RecordId | null;
  name: string | null;
  amount: number; // minor units, positive
  transactionsCount: number;
}

export interface SpendingStatsResponse {
  spendingsByCategory: SpendingByCategoryItem[];
  spendingOverTime: {
    granularity: Granularity;
    periods: SpendingPeriod[];
  };
  spendingsByCurrency: SpendingByCurrencyItem[];
  topPayees: SpendingPayeeItem[];
  biggestDay: { date: string; expense: number } | null; // minor units
}

type Granularity = TrackerSpendingGranularity;

const TOP_PAYEES_LIMIT = 5;

const PERIOD_CONFIG = {
  daily: {
    getStart: (date: Date) => startOfDay(date),
    getEnd: (date: Date) => endOfDay(date),
    advance: (date: Date) => addDays(date, 1),
  },
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
 * targetCategoryIds. Used for subcategory breakdown: when a tracker contains
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

// 184 is the longest six calendar months (e.g. Jul–Dec), so every half-year tracker stays weekly.
const determineGranularity = ({ from, to }: { from: Date; to: Date }): Granularity => {
  const days = differenceInCalendarDays(to, from) + 1;
  if (days <= 62) return 'daily';
  return days <= 184 ? 'weekly' : 'monthly';
};

const getEmptyResponse = (): SpendingStatsResponse => ({
  spendingsByCategory: [],
  spendingOverTime: {
    granularity: 'monthly',
    periods: [],
  },
  spendingsByCurrency: [],
  topPayees: [],
  biggestDay: null,
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
  transactionId: string;
  time: Date;
  amount: number; // minor units
  /** The amount in `currencyCode`. Absent on refund adjustments. */
  nativeAmount?: Money;
  currencyCode?: string;
  payeeId?: RecordId | null;
  isExpense: boolean;
  categoryId: RecordId | null; // aggregation target (root or top-level target), null = skip category aggregation
  originalCategoryId: RecordId | null; // the actual leaf category
  /** When true, subtract `amount` instead of adding. Used to net out refund pairs. */
  negative?: boolean;
}

const determineDateRange = ({
  trackerStartDate,
  trackerEndDate,
  transactionTimes,
}: {
  trackerStartDate: Date | null;
  trackerEndDate: Date | null;
  transactionTimes: Date[];
}): { from: Date; to: Date } => {
  if (trackerStartDate && trackerEndDate) {
    return { from: new Date(trackerStartDate), to: new Date(trackerEndDate) };
  }
  const timestamps = transactionTimes.map((time) => time.getTime());
  return {
    from: new Date(Math.min(...timestamps)),
    to: new Date(Math.max(...timestamps)),
  };
};

const buildSpendingsByCurrency = ({ txDataList }: { txDataList: NormalizedTxData[] }): SpendingByCurrencyItem[] => {
  const byCurrency = new Map<string, SpendingByCurrencyItem>();
  for (const txData of txDataList) {
    if (!txData.isExpense || txData.negative || !txData.currencyCode) continue;
    const entry = byCurrency.get(txData.currencyCode) ?? {
      currencyCode: txData.currencyCode,
      amount: Money.zero(),
      refAmount: 0,
    };
    entry.amount = entry.amount.add(txData.nativeAmount ?? Money.zero());
    entry.refAmount += txData.amount;
    byCurrency.set(txData.currencyCode, entry);
  }
  return [...byCurrency.values()].toSorted((a, b) => b.refAmount - a.refAmount);
};

const buildTopPayees = async ({ txDataList }: { txDataList: NormalizedTxData[] }): Promise<SpendingPayeeItem[]> => {
  const byPayee = new Map<RecordId | null, { amount: number; transactionIds: Set<string> }>();
  for (const txData of txDataList) {
    if (!txData.isExpense || txData.negative || txData.payeeId === undefined) continue;
    const entry = byPayee.get(txData.payeeId) ?? { amount: 0, transactionIds: new Set<string>() };
    entry.amount += txData.amount;
    entry.transactionIds.add(txData.transactionId);
    byPayee.set(txData.payeeId, entry);
  }

  const top = [...byPayee.entries()].toSorted((a, b) => b[1].amount - a[1].amount).slice(0, TOP_PAYEES_LIMIT);
  const payeeIds = top.map(([payeeId]) => payeeId).filter((id): id is RecordId => id !== null);
  const payees = payeeIds.length
    ? await Payees.findAll({
        where: { id: { [Op.in]: payeeIds } },
        attributes: ['id', 'name', 'logoDomain', 'logoInitials', 'logoColor', 'logoIcon', 'logoImageId'],
      })
    : [];
  const payeeById = new Map(payees.map((payee) => [payee.id, payee]));

  return top.map(([payeeId, entry]) => {
    const payee = payeeId === null ? undefined : payeeById.get(payeeId);
    return {
      payeeId,
      name: payee?.name ?? null,
      ...serializeLogoFields({ entity: payee ?? EMPTY_LOGO_FIELDS }),
      amount: entry.amount,
      transactionsCount: entry.transactionIds.size,
    };
  });
};

const findBiggestDay = ({ txDataList }: { txDataList: NormalizedTxData[] }): SpendingStatsResponse['biggestDay'] => {
  const expenseByDay = new Map<string, number>();
  for (const txData of txDataList) {
    if (!txData.isExpense) continue;
    const day = format(txData.time, 'yyyy-MM-dd');
    expenseByDay.set(day, (expenseByDay.get(day) ?? 0) + (txData.negative ? -txData.amount : txData.amount));
  }

  let biggest: SpendingStatsResponse['biggestDay'] = null;
  for (const [date, expense] of expenseByDay) {
    if (expense > 0 && (!biggest || expense > biggest.expense)) biggest = { date, expense };
  }
  return biggest;
};

const aggregateTransactionData = async ({
  txDataList,
  trackerStartDate,
  trackerEndDate,
  categoryMap,
}: {
  txDataList: NormalizedTxData[];
  trackerStartDate: Date | null;
  trackerEndDate: Date | null;
  categoryMap: Map<string, CategoryInfo>;
}): Promise<SpendingStatsResponse> => {
  const { from: rangeFrom, to: rangeTo } = determineDateRange({
    trackerStartDate,
    trackerEndDate,
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
    // ponytail: refund pairs carry no currency/payee, so these two report gross spend; thread them through refund-pairs to net.
    spendingsByCurrency: buildSpendingsByCurrency({ txDataList }),
    topPayees: await buildTopPayees({ txDataList }),
    biggestDay: findBiggestDay({ txDataList }),
  };
};

/**
 * Builds negative `NormalizedTxData` entries from refund pairs so `aggregateTransactionData`
 * nets them out of the period income/expense and per-category expense aggregations. For each
 * side of a pair that's in the tracker, we subtract `refundTx.refAmount` — matching the global
 * "Expenses Structure" widget's refund handling.
 */
const buildRefundAdjustments = ({
  pairs,
  resolveCategoryBucket,
  decimals,
}: {
  pairs: TrackerRefundPair[];
  resolveCategoryBucket: (categoryId: RecordId) => RecordId | null;
  decimals: number;
}): NormalizedTxData[] => {
  const adjustments: NormalizedTxData[] = [];

  for (const pair of pairs) {
    const adjustmentAmount = pair.refundTx.refAmount.toMinorUnits({ decimals });

    const pushSide = ({
      tx,
      overrideCategoryId,
    }: {
      tx: TrackerRefundPair['originalTx'];
      overrideCategoryId: RecordId | null;
    }) => {
      const isExpense = tx.transactionType === TRANSACTION_TYPES.expense;
      const targetCategoryId = overrideCategoryId ?? tx.categoryId;
      const resolved = isExpense ? resolveCategoryBucket(targetCategoryId) : null;
      adjustments.push({
        transactionId: tx.id,
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

/**
 * Manual tracker: fetch transactions via the TrackerTransactions junction (no userId
 * filter, so recipient contributions count) and group by root category.
 *
 * Shared-tracker category breakdown merges by `Categories.key`: a recipient's seeded
 * category folds into the owner's matching one (display shows owner's name/color); a
 * recipient's custom (null-key) category buckets under a synthetic "Other" row. See
 * `buildSharedTrackerMergeMap` for the full strategy. For non-shared trackers, the merge
 * map is identity-only and behaviour matches the pre-share implementation.
 */
const getManualTrackerSpendingStats = async ({
  userId: ownerUserId,
  trackerId,
  callerUserId,
  decimals,
}: {
  userId: number;
  trackerId: string;
  callerUserId: number;
  decimals: number;
}): Promise<SpendingStatsResponse> => {
  const trackerDetails = await findOrThrowNotFound({
    query: Trackers.findOne({ where: { id: trackerId, userId: ownerUserId } }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const transactions = await Transactions.findWithFilters({
    excludeTransfer: true,
    trackerIds: [trackerId],
    completeness: 'all',
    planned: { visibleTo: callerUserId },
    access: 'pre-scoped',
    balanceAdjustments: 'include',
    attributes: [
      'id',
      'time',
      'amount',
      'refAmount',
      'currencyCode',
      'payeeId',
      'transactionType',
      'categoryId',
      'refundLinked',
      'userId',
    ],
  });

  if (transactions.length === 0) return getEmptyResponse();

  // Contributors = owner (always, even with no own tx) + every userId that authored a
  // tx attached to this tracker. Owner's tree must be loaded so the merge map has key->id
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

  const mergeMap = buildSharedTrackerMergeMap({ categories: allCategoriesRaw, ownerUserId });
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

  // A row with no base-currency amount (custom currency, no rate yet) cannot be added to a base-currency
  // figure, so every budget aggregate leaves it out.
  const txDataList: NormalizedTxData[] = transactions.flatMap((tx) => {
    if (tx.refAmount === null) return [];

    const rootCatId = tx.categoryId
      ? canonicalize(getRootCategoryId({ categoryId: tx.categoryId, categoryMap }))
      : null;
    return {
      transactionId: tx.id,
      time: tx.time,
      amount: tx.refAmount.toMinorUnits({ decimals }),
      nativeAmount: tx.amount,
      currencyCode: tx.currencyCode,
      payeeId: tx.payeeId,
      isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
      categoryId: rootCatId,
      // Apply the merge map to the child id too — otherwise we'd render duplicate
      // "Groceries" rows under "Food" (one each for owner's and recipient's
      // categoryId, both meaning the same thing).
      originalCategoryId: canonicalChildId(tx.categoryId),
    };
  });

  const refundPairs = await fetchTrackerRefundPairs({ countedTransactions: transactions });
  const refundAdjustments = buildRefundAdjustments({
    pairs: refundPairs,
    resolveCategoryBucket: (categoryId) => canonicalize(getRootCategoryId({ categoryId, categoryMap })),
    decimals,
  });

  return aggregateTransactionData({
    txDataList: [...txDataList, ...refundAdjustments],
    trackerStartDate: trackerDetails.startDate,
    trackerEndDate: trackerDetails.endDate,
    categoryMap,
  });
};

/**
 * Category tracker: fetch transactions by category IDs, handle splits
 */
const getCategoryTrackerSpendingStats = async ({
  userId,
  trackerId,
  isOwner,
  decimals,
}: {
  userId: number;
  trackerId: string;
  isOwner: boolean;
  decimals: number;
}): Promise<SpendingStatsResponse> => {
  const trackerDetails = await findOrThrowNotFound({
    query: Trackers.findOne({
      where: { id: trackerId, userId },
      include: [{ model: Categories, as: 'categories', attributes: ['id'] }],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const trackerCategoryIds = trackerDetails.categories?.map((c) => c.id) || [];

  if (!trackerCategoryIds.length) return getEmptyResponse();

  const dateFilter = buildDateFilter({
    startDate: trackerDetails.startDate,
    endDate: trackerDetails.endDate,
  });

  // Fetch all user categories for hierarchy
  const allCategoriesRaw = (await Categories.findAll({
    where: { userId },
    attributes: ['id', 'name', 'color', 'parentId'],
    raw: true,
  })) as unknown as { id: RecordId; name: string; color: string; parentId: RecordId | null }[];
  const categoryMap = buildCategoryMap({ categories: allCategoriesRaw });
  const targetCategoryIds = new Set<RecordId>(trackerCategoryIds);

  // Expand target categories to include all descendants
  const expandedCategoryIds = new Set<RecordId>(trackerCategoryIds);
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
    window: { from: trackerDetails.startDate ?? undefined, to: trackerDetails.endDate ?? undefined },
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
        attributes: ['id', 'time', 'transactionType', 'refundLinked', 'currencyCode', 'payeeId'],
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
    if (tx.refAmount === null) continue;

    const topLevelCatId = getTopLevelTargetCategoryId({
      categoryId: tx.categoryId!,
      categoryMap,
      targetCategoryIds,
    });

    txDataList.push({
      transactionId: tx.id,
      time: tx.time,
      amount: tx.refAmount.toMinorUnits({ decimals }),
      nativeAmount: tx.amount,
      currencyCode: tx.currencyCode,
      payeeId: tx.payeeId,
      isExpense: tx.transactionType === TRANSACTION_TYPES.expense,
      categoryId: topLevelCatId,
      originalCategoryId: tx.categoryId!,
    });
    countedTransactions.push({ id: tx.id, refundLinked: tx.refundLinked });
  }

  // Process splits
  for (const split of matchingSplits) {
    const transaction = split.get('transaction') as Transactions.default;
    if (!transaction || split.refAmount === null) continue;

    const topLevelCatId = getTopLevelTargetCategoryId({
      categoryId: split.categoryId,
      categoryMap,
      targetCategoryIds,
    });

    txDataList.push({
      transactionId: transaction.id,
      time: transaction.time,
      amount: split.refAmount.toMinorUnits({ decimals }),
      nativeAmount: split.amount,
      currencyCode: transaction.currencyCode,
      payeeId: transaction.payeeId,
      isExpense: transaction.transactionType === TRANSACTION_TYPES.expense,
      categoryId: topLevelCatId,
      originalCategoryId: split.categoryId,
    });
    countedTransactions.push({ id: transaction.id, refundLinked: transaction.refundLinked });
  }

  if (txDataList.length === 0) return getEmptyResponse();

  const refundPairs = await fetchTrackerRefundPairs({ countedTransactions });
  const refundAdjustments = buildRefundAdjustments({
    pairs: refundPairs,
    resolveCategoryBucket: (categoryId) => getTopLevelTargetCategoryId({ categoryId, categoryMap, targetCategoryIds }),
    decimals,
  });

  return aggregateTransactionData({
    txDataList: [...txDataList, ...refundAdjustments],
    trackerStartDate: trackerDetails.startDate,
    trackerEndDate: trackerDetails.endDate,
    categoryMap,
  });
};

/** The stats with the `decimals` their minor units are at, which the serializer needs to turn them into decimals. */
interface TrackerSpendingStatsResult {
  stats: SpendingStatsResponse;
  decimals: number;
}

export const getTrackerSpendingStats = async ({
  userId,
  trackerId,
}: {
  userId: number;
  trackerId: string;
}): Promise<TrackerSpendingStatsResult> => {
  // Share-aware auth: recipient sees the same numbers the owner would (per PRD
  // visibility decision). Downstream queries scope against the owner's userId so
  // a recipient's unrelated transactions don't filter the result.
  const { ownerUserId, isOwner } = await authorizeTrackerRead({ userId, trackerId });

  const trackerDetails = await findOrThrowNotFound({
    query: Trackers.findOne({ where: { id: trackerId, userId: ownerUserId }, attributes: ['type'] }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  // The tracker's amounts are in its owner's base currency, whoever reads them.
  const decimals = await getBaseCurrencyDecimals({ userId: ownerUserId });

  const stats =
    trackerDetails.type === TRACKER_TYPES.category
      ? await getCategoryTrackerSpendingStats({ userId: ownerUserId, trackerId, isOwner, decimals })
      : await getManualTrackerSpendingStats({ userId: ownerUserId, trackerId, callerUserId: userId, decimals });

  return { stats, decimals };
};
