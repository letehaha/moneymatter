import { type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Categories from '@models/categories.model';
import TrackerLines from '@models/tracker-lines.model';
import Trackers from '@models/trackers.model';
import { findTransactions } from '@models/transactions-query';
import type * as Transactions from '@models/transactions.model';
import { moneyMovementWhere } from '@services/stats/stats-transactions';
import { includeLines } from '@services/trackers/get-trackers';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { authorizeTrackerRead } from './authorize-tracker-access';
import { fetchTrackerRefundPairs } from './utils/refund-pairs';
import { buildSharedTrackerMergeMap } from './utils/shared-category-merge-map';

export interface StatsResponse {
  summary: {
    actualIncome: number;
    actualExpense: number;
    balance: number; // Net difference
    utilizationRate: null | number; // Percentage used (0-100)
    transactionsCount: number;
    firstTransactionDate: string | null; // ISO date string of earliest transaction
    lastTransactionDate: string | null; // ISO date string of latest transaction
  };
  /** Cents, in line `position` order. */
  lines: { lineId: RecordId; spent: number }[];
  /** Cents of expenses no line matched. */
  otherSpent: number;
}

interface ExpenseEntry {
  categoryId: string;
  cents: number;
}

export const getResponseInitialState = (): StatsResponse => ({
  summary: {
    actualIncome: 0,
    actualExpense: 0,
    balance: 0, // Net difference
    utilizationRate: null, // Percentage used (0-100)
    transactionsCount: 0,
    firstTransactionDate: null,
    lastTransactionDate: null,
  },
  lines: [],
  otherSpent: 0,
});

/**
 * An expense lands in the first line (by position, then id) whose categories contain its category.
 * ponytail: refund netting is not applied to line totals or `otherSpent`.
 */
const splitExpensesByLines = ({
  lines,
  expenses,
}: {
  lines: TrackerLines[];
  expenses: ExpenseEntry[];
}): Pick<StatsResponse, 'lines' | 'otherSpent'> => {
  const totals = lines.map((line) => ({ lineId: line.id, spent: 0 }));
  const lineIndexByCategory = new Map<string, number>();
  lines.forEach((line, index) => {
    for (const category of line.categories ?? []) {
      if (!lineIndexByCategory.has(category.id)) lineIndexByCategory.set(category.id, index);
    }
  });

  let otherSpent = 0;
  for (const { categoryId, cents } of expenses) {
    const index = lineIndexByCategory.get(categoryId);
    if (index === undefined) otherSpent += cents;
    else totals[index]!.spent += cents;
  }

  return { lines: totals, otherSpent };
};

/** A `write` recipient's attached transactions carry their own category ids; lines hold the owner's. */
const buildCategoryCanonicalizer = async ({
  ownerUserId,
  transactions,
}: {
  ownerUserId: number;
  transactions: Pick<Transactions.default, 'userId'>[];
}): Promise<(categoryId: RecordId) => RecordId> => {
  const userIds = new Set([ownerUserId, ...transactions.map((tx) => tx.userId)]);
  if (userIds.size === 1) return (categoryId) => categoryId;

  const categories = (await Categories.findAll({
    where: { userId: { [Op.in]: [...userIds] } },
    attributes: ['id', 'key', 'userId'],
    raw: true,
  })) as unknown as { id: RecordId; key: string | null; userId: number }[];
  const mergeMap = buildSharedTrackerMergeMap({ categories, ownerUserId });
  return (categoryId) => mergeMap.get(categoryId) ?? categoryId;
};

/**
 * Junction-only scope on the transaction lookup: any row in `TrackerTransactions` for
 * this tracker is counted, regardless of `Transactions.userId`. This is what lets a
 * `write` recipient's attached transactions contribute to the shared-tracker totals
 * (income/expense/balance/utilization). The caller's authorization happens upstream
 * via `authorizeTrackerRead`, so we trust the trackerId scope here.
 *
 * Planned rows are the exception to the junction-only scope: only the caller's own
 * plans count, so a recipient's totals never include the owner's plans.
 */
const getLinkedTransactionsStats = async ({
  trackerId,
  callerUserId,
  lines,
}: {
  trackerId: string;
  callerUserId: number;
  lines: TrackerLines[];
}): Promise<StatsResponse> => {
  const trackerDetails = await findOrThrowNotFound({
    query: Trackers.findByPk(trackerId),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const transactions: Pick<
    Transactions.default,
    'id' | 'time' | 'amount' | 'refAmount' | 'transactionType' | 'refundLinked' | 'categoryId' | 'userId'
  >[] = await findTransactions({
    where: moneyMovementWhere,
    access: { trackerScoped: [trackerId as RecordId] },
    completeness: 'all',
    planned: { visibleTo: callerUserId },
    balanceAdjustments: 'include',
    attributes: ['id', 'time', 'amount', 'refAmount', 'transactionType', 'refundLinked', 'categoryId', 'userId'],
  });

  const limitAmount = trackerDetails.limitAmount?.toCents() ?? null;
  const result = aggregateTransactionStats({ transactions, limitAmount });
  await applyRefundAdjustments({ countedTransactions: transactions, result, limitAmount });

  const canonicalize = await buildCategoryCanonicalizer({ ownerUserId: trackerDetails.userId, transactions });

  // ponytail: matches on the primary categoryId, so a split transaction lands whole in one line.
  // Read the transaction's splits here if trackers need per-split line totals.
  const expenses = transactions
    .filter((tx) => tx.transactionType === TRANSACTION_TYPES.expense)
    .map((tx) => ({ categoryId: canonicalize(tx.categoryId), cents: tx.refAmount.toCents() }));
  return { ...result, ...splitExpensesByLines({ lines, expenses }) };
};

/**
 * Helper to update date range in stats
 */
const updateDateRange = (result: StatsResponse, time: Date) => {
  const txDate = new Date(time).toISOString();
  if (!result.summary.firstTransactionDate || txDate < result.summary.firstTransactionDate) {
    result.summary.firstTransactionDate = txDate;
  }
  if (!result.summary.lastTransactionDate || txDate > result.summary.lastTransactionDate) {
    result.summary.lastTransactionDate = txDate;
  }
};

/**
 * Nets out refund pairs from actualIncome/actualExpense so a refund-income doesn't inflate
 * income and the matching expense reflects net spend (matching the global "Expenses Structure"
 * widget). For each refund where a side is in the tracker, we subtract `refundTx.refAmount`
 * from that side. Balance and utilizationRate are recomputed from the adjusted totals.
 */
const applyRefundAdjustments = async ({
  countedTransactions,
  result,
  limitAmount,
}: {
  countedTransactions: { id: string; refundLinked: boolean }[];
  result: StatsResponse;
  limitAmount: number | null;
}): Promise<void> => {
  const pairs = await fetchTrackerRefundPairs({ countedTransactions });
  if (pairs.length === 0) return;

  for (const pair of pairs) {
    const adjustment = pair.refundTx.refAmount.toCents();

    if (pair.originalInScope) {
      if (pair.originalTx.transactionType === TRANSACTION_TYPES.expense) {
        result.summary.actualExpense -= adjustment;
      } else {
        result.summary.actualIncome -= adjustment;
      }
    }

    if (pair.refundInScope) {
      if (pair.refundTx.transactionType === TRANSACTION_TYPES.expense) {
        result.summary.actualExpense -= adjustment;
      } else {
        result.summary.actualIncome -= adjustment;
      }
    }
  }

  result.summary.balance = result.summary.actualIncome - result.summary.actualExpense;
  if (limitAmount !== null) {
    const netSpending = Math.max(0, -result.summary.balance);
    result.summary.utilizationRate = (netSpending / limitAmount) * 100;
  }
};

/**
 * Helper to aggregate transaction stats
 */
const aggregateTransactionStats = ({
  transactions,
  limitAmount,
}: {
  transactions: Pick<Transactions.default, 'time' | 'refAmount' | 'transactionType'>[];
  limitAmount: number | null;
}): StatsResponse => {
  const result = transactions.reduce((acc, curr) => {
    const isExpense = curr.transactionType === TRANSACTION_TYPES.expense;
    const refAmount = curr.refAmount.toCents();

    if (isExpense) {
      acc.summary.actualExpense += refAmount;
      acc.summary.balance -= refAmount;
    } else {
      acc.summary.actualIncome += refAmount;
      acc.summary.balance += refAmount;
    }

    updateDateRange(acc, curr.time);
    return acc;
  }, getResponseInitialState());

  result.summary.transactionsCount = transactions.length;

  if (limitAmount !== null) {
    const netSpending = Math.max(0, -result.summary.balance);
    result.summary.utilizationRate = (netSpending / limitAmount) * 100;
  }

  return result;
};

export const getTrackerStats = withTransaction(
  async ({ userId, trackerId }: { userId: number; trackerId: string }): Promise<StatsResponse> => {
    // Share-aware auth: recipient sees the same numbers the owner would (per PRD visibility decision).
    await authorizeTrackerRead({ userId, trackerId });

    const trackerDetails = await findOrThrowNotFound({
      query: Trackers.findByPk(trackerId, { attributes: ['id'], include: [includeLines] }),
      message: t({ key: 'budgets.budgetNotFound' }),
    });

    return getLinkedTransactionsStats({ trackerId, callerUserId: userId, lines: trackerDetails.lines ?? [] });
  },
);
