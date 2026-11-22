import {
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionsSummaryResponse,
  dedupeTransferLegs,
  sumTransactionTotals,
} from '@bt/shared/types';
import { getReportBaseCurrencyDecimals } from '@common/lib/currency-precision';
import { Money, minorUnitsToApiDecimal } from '@common/types/money';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import { allocateTransaction, loadSplitsByTxId } from '@services/stats/category-allocation';

import { getTransactions } from './get-transactions';

type ListFilters = Omit<
  Parameters<typeof getTransactions>[0],
  'from' | 'limit' | 'order' | 'sortBy' | 'attributes' | 'isRaw'
>;

/** `refAmount` is the exact DECIMAL string the raw read returns. */
interface MatchingRow {
  id: string;
  userId: number;
  accountId: RecordId;
  transactionType: TRANSACTION_TYPES;
  transferNature: TRANSACTION_TRANSFER_NATURE;
  transferId: string | null;
  categoryId: string | null;
  refAmount: string;
}

/** Every transaction the list shows for these filters, with the list's visibility scope. */
const findMatchingRows = async (filters: ListFilters): Promise<MatchingRow[]> => {
  // ponytail: loads every matching row and aggregates in JS. Move to a SQL aggregate
  // if summaries get slow on very large ledgers.
  // The raw read makes `refAmount` the DECIMAL column's exact string.
  return (await getTransactions({
    ...filters,
    isRaw: true,
    limit: Infinity,
    attributes: [
      'id',
      'userId',
      'accountId',
      'transactionType',
      'transferNature',
      'transferId',
      'categoryId',
      'refAmount',
    ],
  })) as unknown as MatchingRow[];
};

/** A matching row with `refAmount` in integer minor units of the base currency. */
type MinorUnitsRow = Omit<MatchingRow, 'refAmount'> & { refAmount: number };

/** Under a category filter a split row counts only the share booked to those categories. */
const scopeToCategories = async ({
  rows,
  categoryIds,
  decimals,
}: {
  rows: MinorUnitsRow[];
  categoryIds?: string[];
  decimals: number;
}): Promise<MinorUnitsRow[]> => {
  if (!categoryIds?.length) return rows;

  const splitsByTxId = await loadSplitsByTxId({ transactionIds: rows.map((row) => row.id) });
  const wanted = new Set(categoryIds);

  return rows.map((row) => {
    const splits = splitsByTxId.get(row.id);
    if (!splits) return row;
    const refAmount = allocateTransaction({ minor: row.refAmount, categoryId: row.categoryId, splits, decimals })
      .filter((leg) => leg.categoryId !== null && wanted.has(leg.categoryId))
      .reduce((sum, leg) => sum + leg.minor, 0);
    return { ...row, refAmount };
  });
};

export const getTransactionsSummary = async (filters: ListFilters): Promise<TransactionsSummaryResponse> => {
  const decimals = await getReportBaseCurrencyDecimals({ userId: filters.userId });
  const rows = dedupeTransferLegs(await findMatchingRows(filters));
  // Summed in the base currency's minor units, so the totals are exact integers.
  const minorRows = rows.map((row) => ({
    ...row,
    refAmount: Money.fromDecimal(row.refAmount).toMinorUnits({ decimals }),
  }));
  const totals = sumTransactionTotals(
    await scopeToCategories({ rows: minorRows, categoryIds: filters.categoryIds, decimals }),
  );

  return {
    count: rows.length,
    income: minorUnitsToApiDecimal({ value: totals.income, decimals }),
    expense: minorUnitsToApiDecimal({ value: totals.expense, decimals }),
    net: minorUnitsToApiDecimal({ value: totals.net, decimals }),
    transfers: minorUnitsToApiDecimal({ value: totals.transfers, decimals }),
  };
};

/**
 * Ids a bulk action acts on. A filter selection resolves to the rows the caller created
 * on accounts they own: the same rows the UI lets them tick, so rows on accounts shared
 * with them stay out even when they were never loaded client-side.
 */
export const resolveBulkTargetIds = async ({
  userId,
  transactionIds,
  selection,
}: {
  userId: number;
  transactionIds?: string[];
  selection?: { filters: Omit<ListFilters, 'userId'>; excludedIds: string[] };
}): Promise<string[]> => {
  if (transactionIds) return transactionIds;
  if (!selection) throw new ValidationError({ message: 'Provide either transactionIds or selection' });

  const [rows, ownedAccounts] = await Promise.all([
    findMatchingRows({ ...selection.filters, userId }),
    Accounts.findAll({ where: { userId }, attributes: ['id'], raw: true }),
  ]);
  const ownedAccountIds = new Set(ownedAccounts.map((account) => account.id));

  // Unticking either leg of a transfer keeps the whole transfer out: the client may show
  // the income leg while the expense leg, the one kept by the dedup, is still unloaded.
  const excludedIds = new Set(selection.excludedIds);
  const excludedTransferIds = new Set(
    rows.filter((row) => excludedIds.has(row.id) && row.transferId).map((row) => row.transferId),
  );

  return dedupeTransferLegs(
    rows.filter(
      (row) =>
        row.userId === userId &&
        ownedAccountIds.has(row.accountId) &&
        !excludedIds.has(row.id) &&
        !excludedTransferIds.has(row.transferId),
    ),
  ).map((row) => row.id);
};
