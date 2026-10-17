import { BUDGET_TYPES, type RecordId, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import Accounts from '@models/accounts.model';
import Budgets from '@models/budget.model';
import Categories from '@models/categories.model';
import TrackerLines from '@models/tracker-lines.model';
import TransactionSplits from '@models/transaction-splits.model';
import { PlannedPolicy, transactionsInclude } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { includeLines } from '@services/budget.service';
import { statsTransactions } from '@services/stats/stats-transactions';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { authorizeBudgetRead } from './authorize-budget-access';
import { buildDateFilter } from './utils/build-date-filter';
import { fetchBudgetRefundPairs } from './utils/refund-pairs';
import { buildSharedBudgetMergeMap } from './utils/shared-category-merge-map';

interface StatsResponse {
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
  lines: { lineId: string; spent: number }[];
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
  const mergeMap = buildSharedBudgetMergeMap({ categories, ownerUserId });
  return (categoryId) => mergeMap.get(categoryId) ?? categoryId;
};

/**
 * Calculate stats for manual budgets using BudgetTransactions junction table.
 *
 * Junction-only scope on the transaction lookup: any row in `BudgetTransactions` for
 * this budget is counted, regardless of `Transactions.userId`. This is what lets a
 * `write` recipient's attached transactions contribute to the shared-budget totals
 * (income/expense/balance/utilization). The caller's authorization happens upstream
 * via `authorizeBudgetRead`, so we trust the budgetId scope here.
 *
 * Category budgets keep the legacy owner-only filter — recipients can't manually
 * attach to a category budget (it'd trip `cannotManuallyLinkToCategoryBudget`), so
 * widening that path would be a no-op today.
 *
 * Planned rows are the exception to the junction-only scope: only the caller's own
 * plans count, so a recipient's totals never include the owner's plans.
 */
const getManualBudgetStats = async ({
  budgetId,
  callerUserId,
  lines,
}: {
  budgetId: string;
  callerUserId: number;
  lines: TrackerLines[];
}): Promise<StatsResponse> => {
  const budgetDetails = await findOrThrowNotFound({
    query: Budgets.findByPk(budgetId),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const transactions: Pick<
    Transactions.default,
    'id' | 'time' | 'amount' | 'refAmount' | 'transactionType' | 'refundLinked' | 'categoryId' | 'userId'
  >[] = await Transactions.findWithFilters({
    excludeTransfer: true,
    budgetIds: [budgetId],
    completeness: 'all',
    planned: { visibleTo: callerUserId },
    access: 'pre-scoped',
    balanceAdjustments: 'include',
    attributes: ['id', 'time', 'amount', 'refAmount', 'transactionType', 'refundLinked', 'categoryId', 'userId'],
  });

  const limitAmount = budgetDetails.limitAmount?.toCents() ?? null;
  const result = aggregateTransactionStats({ transactions, limitAmount });
  await applyRefundAdjustments({ countedTransactions: transactions, result, limitAmount });

  const canonicalize = await buildCategoryCanonicalizer({ ownerUserId: budgetDetails.userId, transactions });

  // ponytail: matches on the primary categoryId, so a split transaction lands whole in one line.
  // Read the transaction's splits here if manual trackers need per-split line totals.
  const expenses = transactions
    .filter((tx) => tx.transactionType === TRANSACTION_TYPES.expense)
    .map((tx) => ({ categoryId: canonicalize(tx.categoryId), cents: tx.refAmount.toCents() }));
  return { ...result, ...splitExpensesByLines({ lines, expenses }) };
};

/**
 * Calculate stats for category-based budgets.
 * Handles split transactions correctly by only counting the split amount for matching categories.
 */
const getCategoryBudgetStats = async ({
  userId,
  budgetId,
  isOwner,
  lines,
}: {
  userId: number;
  budgetId: string;
  isOwner: boolean;
  lines: TrackerLines[];
}): Promise<StatsResponse> => {
  const budgetDetails = await findOrThrowNotFound({
    query: Budgets.findByPk(budgetId, {
      include: [{ model: Categories, as: 'categories', attributes: ['id'] }],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  const categoryIds = budgetDetails.categories?.map((c) => c.id) || [];

  if (!categoryIds.length) {
    return { ...getResponseInitialState(), ...splitExpensesByLines({ lines, expenses: [] }) };
  }

  const dateFilter = buildDateFilter({
    startDate: budgetDetails.startDate,
    endDate: budgetDetails.endDate,
  });

  // Planned rows are owner-only: they count as spent for the owner, but a share
  // recipient must never see them.
  const planned: PlannedPolicy = isOwner ? 'include' : 'exclude';

  // Get transactions where primary category matches and have no splits
  const { rows: primaryCategoryTransactions } = await statsTransactions({
    access: { creator: userId },
    planned,
    refunds: 'ignore',
    window: { from: budgetDetails.startDate ?? undefined, to: budgetDetails.endDate ?? undefined },
    where: { categoryId: { [Op.in]: categoryIds } },
    include: [{ model: TransactionSplits, as: 'splits', required: false }],
  });

  // Get splits that match the categories
  const matchingSplits = await TransactionSplits.findAll({
    where: {
      userId,
      categoryId: { [Op.in]: categoryIds },
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

  const result = getResponseInitialState();
  const countedTransactions: { id: string; refundLinked: boolean }[] = [];
  const expenses: ExpenseEntry[] = [];

  // Process primary category transactions (only those WITHOUT splits)
  for (const tx of primaryCategoryTransactions) {
    const splits = tx.get('splits') as TransactionSplits[] | undefined;

    // If transaction has splits, skip it here - we'll count the split amounts separately
    if (splits && splits.length > 0) {
      continue;
    }

    countedTransactions.push({ id: tx.id, refundLinked: tx.refundLinked });
    const isExpense = tx.transactionType === TRANSACTION_TYPES.expense;

    if (isExpense) {
      result.summary.actualExpense += tx.refAmount.toCents();
      result.summary.balance -= tx.refAmount.toCents();
      expenses.push({ categoryId: tx.categoryId, cents: tx.refAmount.toCents() });
    } else {
      result.summary.actualIncome += tx.refAmount.toCents();
      result.summary.balance += tx.refAmount.toCents();
    }

    updateDateRange(result, tx.time);
  }

  // Process splits - only count the split's refAmount
  for (const split of matchingSplits) {
    const transaction = split.get('transaction') as Transactions.default;
    if (!transaction) continue;

    countedTransactions.push({ id: transaction.id, refundLinked: transaction.refundLinked });
    const isExpense = transaction.transactionType === TRANSACTION_TYPES.expense;

    if (isExpense) {
      result.summary.actualExpense += split.refAmount.toCents();
      result.summary.balance -= split.refAmount.toCents();
      expenses.push({ categoryId: split.categoryId, cents: split.refAmount.toCents() });
    } else {
      result.summary.actualIncome += split.refAmount.toCents();
      result.summary.balance += split.refAmount.toCents();
    }

    updateDateRange(result, transaction.time);
  }

  const uniqueCountedIds = new Set(countedTransactions.map((tx) => tx.id));
  result.summary.transactionsCount = uniqueCountedIds.size;

  const limitAmount = budgetDetails.limitAmount?.toCents() ?? null;

  if (limitAmount !== null) {
    const netSpending = Math.max(0, -result.summary.balance);
    result.summary.utilizationRate = (netSpending / limitAmount) * 100;
  }

  await applyRefundAdjustments({ countedTransactions, result, limitAmount });

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
 * widget). For each refund where a side is in the budget, we subtract `refundTx.refAmount`
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
  const pairs = await fetchBudgetRefundPairs({ countedTransactions });
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

export const getBudgetStats = withTransaction(
  async ({ userId, budgetId }: { userId: number; budgetId: string }): Promise<StatsResponse> => {
    // Share-aware auth: recipient sees the same numbers the owner would (per PRD
    // visibility decision). Downstream queries scope against the owner's userId so
    // a recipient's unrelated transactions don't filter the result.
    const { ownerUserId, isOwner } = await authorizeBudgetRead({ userId, budgetId });

    const budgetDetails = await findOrThrowNotFound({
      query: Budgets.findByPk(budgetId, { attributes: ['id', 'type'], include: [includeLines] }),
      message: t({ key: 'budgets.budgetNotFound' }),
    });
    const lines = budgetDetails.lines ?? [];

    if (budgetDetails.type === BUDGET_TYPES.category) {
      return getCategoryBudgetStats({ userId: ownerUserId, budgetId, isOwner, lines });
    }

    return getManualBudgetStats({ budgetId, callerUserId: userId, lines });
  },
);
