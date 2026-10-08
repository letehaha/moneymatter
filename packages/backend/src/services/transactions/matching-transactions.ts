import {
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type endpointsTypes,
  dedupeTransferLegs,
  sumTransactionTotals,
} from '@bt/shared/types';
import { centsToApiDecimal } from '@common/types/money';
import { ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';

import { getTransactions } from './get-transactions';

type ListFilters = Omit<
  Parameters<typeof getTransactions>[0],
  | 'from'
  | 'limit'
  | 'order'
  | 'sortBy'
  | 'attributes'
  | 'includeSplits'
  | 'includeTags'
  | 'includeGroups'
  | 'includeHasAttachments'
>;

interface MatchingRow {
  id: string;
  userId: number;
  accountId: RecordId;
  transactionType: TRANSACTION_TYPES;
  transferNature: TRANSACTION_TRANSFER_NATURE;
  transferId: string | null;
  /** Base-currency cents: the read is raw, so the `Money` getter never runs. */
  refAmount: number;
}

/** Every transaction the list shows for these filters, with the list's visibility scope. */
const findMatchingRows = async (filters: ListFilters): Promise<MatchingRow[]> => {
  // ponytail: loads every matching row and aggregates in JS. Move to a SQL aggregate
  // if summaries get slow on very large ledgers.
  // `getTransactions` reads raw exactly when no `include*` flag is passed, which is
  // what makes `refAmount` a number here.
  const rows = (await getTransactions({
    ...filters,
    limit: Infinity,
    attributes: ['id', 'userId', 'accountId', 'transactionType', 'transferNature', 'transferId', 'refAmount'],
  })) as unknown as MatchingRow[];

  // The tag filter joins TransactionTags, which repeats a row per matching tag.
  return [...new Map(rows.map((row) => [row.id, row])).values()];
};

export const getTransactionsSummary = async (
  filters: ListFilters,
): Promise<endpointsTypes.TransactionsSummaryResponse> => {
  const rows = dedupeTransferLegs(await findMatchingRows(filters));
  const totals = sumTransactionTotals(rows);

  return {
    count: rows.length,
    income: centsToApiDecimal(totals.income),
    expense: centsToApiDecimal(totals.expense),
    net: centsToApiDecimal(totals.net),
    transfers: centsToApiDecimal(totals.transfers),
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
