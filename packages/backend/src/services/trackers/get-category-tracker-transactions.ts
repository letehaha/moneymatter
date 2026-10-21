import { TRACKER_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import Categories from '@models/categories.model';
import Trackers from '@models/trackers.model';
import TransactionSplits from '@models/transaction-splits.model';
import { PlannedPolicy, transactionsInclude } from '@models/transactions-query';
import * as Transactions from '@models/transactions.model';
import { statsTransactions } from '@services/stats/stats-transactions';
import { Op } from 'sequelize';

import { authorizeTrackerRead } from './authorize-tracker-access';
import { buildDateFilter } from './utils/build-date-filter';

/**
 * Get transactions for a category-based tracker.
 * Returns transactions that match the tracker's categories, handling split transactions
 * by returning only the matching split portion.
 */
export const getCategoryTrackerTransactions = async ({
  userId,
  trackerId,
  from = 0,
  limit = 50,
}: GetCategoryTrackerTransactionsParams) => {
  // Share-aware auth: recipient sees owner's transactions on the tracker (per PRD
  // visibility decision), not a recipient-userId slice.
  const { ownerUserId, isOwner } = await authorizeTrackerRead({ userId, trackerId });

  const tracker = await findOrThrowNotFound({
    query: Trackers.findByPk(trackerId, {
      include: [{ model: Categories, as: 'categories', attributes: ['id', 'name', 'color'] }],
    }),
    message: t({ key: 'budgets.budgetNotFound' }),
  });

  if (tracker.type !== TRACKER_TYPES.category) {
    throw new ValidationError({ message: t({ key: 'budgets.notCategoryBudget' }) });
  }

  const categoryIds = tracker.categories?.map((c) => c.id) || [];

  if (!categoryIds.length) {
    return { transactions: [], total: 0 };
  }

  const dateFilter = buildDateFilter({
    startDate: tracker.startDate,
    endDate: tracker.endDate,
  });

  // Planned rows are owner-only: they count as spent for the owner, but a share
  // recipient must never see them.
  const planned: PlannedPolicy = isOwner ? 'include' : 'exclude';

  // Get transactions where primary category matches and have no splits
  const { rows: primaryCategoryTransactions } = await statsTransactions({
    access: { creator: ownerUserId },
    planned,
    refunds: 'ignore',
    window: { from: tracker.startDate ?? undefined, to: tracker.endDate ?? undefined },
    where: { categoryId: { [Op.in]: categoryIds } },
    include: [
      { model: TransactionSplits, as: 'splits', required: false },
      { model: Categories, as: 'category', attributes: ['id', 'name', 'color'] },
    ],
    order: [['time', 'DESC']],
  });

  // Get splits that match the categories
  const matchingSplits = await TransactionSplits.findAll({
    where: {
      userId: ownerUserId,
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
        attributes: ['id', 'time', 'transactionType', 'note', 'accountId'],
        include: [{ model: Accounts, where: { excludeFromStats: false }, attributes: [] }],
      }),
      {
        model: Categories,
        as: 'category',
        attributes: ['id', 'name', 'color'],
      },
    ],
  });

  // Combine results
  const results: TransactionWithCategory[] = [];
  const seenTransactionIds = new Set<string>();

  // Process primary category transactions (only those WITHOUT splits)
  for (const tx of primaryCategoryTransactions) {
    const splits = tx.get('splits') as TransactionSplits[] | undefined;
    const category = tx.get('category') as Categories | undefined;

    // If transaction has splits, skip it here - we'll include split entries separately
    if (splits && splits.length > 0) {
      continue;
    }

    // Budgets spend in base currency; a row with no base-currency amount (custom currency, no rate
    // yet) is not part of the spent figure, so it is not listed under it either.
    if (tx.refAmount === null) continue;

    seenTransactionIds.add(tx.id);
    results.push({
      id: tx.id,
      time: tx.time,
      transactionType: tx.transactionType,
      refAmount: tx.refAmount.toNumber(),
      amount: tx.amount.toNumber(),
      note: tx.note,
      categoryId: tx.categoryId,
      accountId: tx.accountId,
      effectiveCategory: category
        ? {
            id: category.id,
            name: category.name,
            color: category.color,
          }
        : undefined,
      effectiveRefAmount: tx.refAmount.toNumber(),
    });
  }

  // Process splits - add each matching split as a separate entry
  for (const split of matchingSplits) {
    const transaction = split.get('transaction') as Transactions.default;
    const category = split.get('category') as Categories | undefined;

    if (!transaction || split.refAmount === null) continue;

    results.push({
      id: transaction.id,
      time: transaction.time,
      transactionType: transaction.transactionType,
      refAmount: split.refAmount.toNumber(),
      amount: split.amount.toNumber(),
      note: transaction.note,
      categoryId: split.categoryId,
      accountId: transaction.accountId,
      effectiveCategory: category
        ? {
            id: category.id,
            name: category.name,
            color: category.color,
          }
        : undefined,
      effectiveRefAmount: split.refAmount.toNumber(),
    });

    seenTransactionIds.add(transaction.id);
  }

  // Sort by time DESC
  results.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const total = results.length;
  const paginatedResults = results.slice(from, from + limit);

  return {
    transactions: paginatedResults,
    total,
  };
};

interface TransactionWithCategory {
  id: string;
  time: Date;
  transactionType: TRANSACTION_TYPES;
  refAmount: number;
  amount: number;
  note: string | null;
  categoryId: string | null;
  accountId: string;
  /** For split transactions, this is the split's category */
  effectiveCategory?: {
    id: string;
    name: string;
    color: string;
  };
  /** For split transactions, this is the split amount */
  effectiveRefAmount?: number;
}

interface GetCategoryTrackerTransactionsParams {
  userId: number;
  trackerId: string;
  from?: number;
  limit?: number;
}
