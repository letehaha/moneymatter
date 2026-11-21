import { ACCOUNT_TYPES, type BulkDeleteTransactionsResponse, TRANSACTION_TRASH_ACTION_MAX } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import * as Transactions from '@models/transactions.model';
import { isRowDeletableOnAccount, SEAM_ACCOUNT_ATTRIBUTES } from '@services/accounts/seam';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { deleteTransaction } from './delete-transaction';
import { isLinkedLeg } from './payment-legs';
import { findNonTrashableIds } from './trash/find-non-trashable-ids';

/** Each row is deleted one by one inside a single DB transaction, so a request stays bounded. */
const MAX_BULK_DELETE = TRANSACTION_TRASH_ACTION_MAX;

interface BulkDeleteParams {
  userId: number;
  transactionIds: string[];
  /** Background jobs pass `Infinity`; they hold no HTTP request open. */
  maxCount?: number;
  /** Hard-delete instead of moving to Trash. */
  permanent?: boolean;
}

/**
 * Deletes a set of transactions in a single DB transaction (all-or-nothing).
 *
 * Rows on a bank-linked account (account type !== system) are rejected up-front with a
 * structured error listing the offending ids — the API must enforce this
 * regardless of what the client sends, since external transactions are owned
 * by the bank sync and deleting them would desync balances on the next sync.
 * A plan on a provider account is exempt: the bank has never reported it, so
 * deleting it takes nothing away from the sync. So is a manual row dated before the seam.
 *
 * Each row goes through `deleteTransaction`, which handles per-row write
 * authorization, transfer-pair cleanup, refund unlinking, and portfolio
 * transfer reversal. When a common-transfer leg is deleted its twin goes with
 * it, so a twin that was also selected is skipped instead of failing with 404.
 *
 * Rows that cannot go to Trash (payment, portfolio, venture links) are skipped and
 * returned in `skippedIds`. With `permanent`, a payment's created rows whose main row
 * was selected are skipped instead, since the main takes them along.
 */
const bulkDeleteImpl = async ({
  userId,
  transactionIds,
  maxCount = MAX_BULK_DELETE,
  permanent = false,
}: BulkDeleteParams): Promise<BulkDeleteTransactionsResponse> => {
  const uniqueIds = [...new Set(transactionIds)];

  if (uniqueIds.length > maxCount) {
    throw new ValidationError({ message: t({ key: 'transactions.bulkDeleteLimitExceeded' }) });
  }

  const rows = (await Transactions.default.findAll({
    where: { id: { [Op.in]: uniqueIds }, userId },
    attributes: [
      'id',
      'accountId',
      'accountType',
      'time',
      'transferId',
      'isPlanned',
      'paymentParentId',
      'paymentLinkSnapshot',
    ],
    raw: true,
  })) as unknown as Array<{
    id: string;
    accountId: string;
    accountType: ACCOUNT_TYPES;
    time: Date;
    transferId: string | null;
    isPlanned: boolean;
    paymentParentId: string | null;
    paymentLinkSnapshot: Transactions.PaymentLinkSnapshot | null;
  }>;

  if (rows.length === 0) {
    throw new NotFoundError({ message: 'No valid transactions found' });
  }

  const providerAccounts = await Accounts.findAll({
    where: { id: { [Op.in]: rows.map((row) => row.accountId) }, type: { [Op.ne]: ACCOUNT_TYPES.system } },
    attributes: [...SEAM_ACCOUNT_ATTRIBUTES, 'id'],
  });
  const providerAccountsById = new Map<string, Accounts>(providerAccounts.map((account) => [account.id, account]));

  const disallowed = rows.filter((row) => {
    const account = providerAccountsById.get(row.accountId);
    return account && !row.isPlanned && !isRowDeletableOnAccount({ account, transaction: row });
  });
  if (disallowed.length > 0) {
    const isBankRowsOnly =
      disallowed.length === rows.length && disallowed.every((row) => row.accountType !== ACCOUNT_TYPES.system);
    throw new ValidationError({
      message: t({
        key: isBankRowsOnly ? 'transactions.cannotDeleteExternal' : 'transactions.bulkDeleteBankRowsSelected',
      }),
      details: { disallowedIds: disallowed.map((row) => row.id) },
    });
  }

  const deletedIds: string[] = [];
  const deletedTransferIds = new Set<string>();

  const selectedIds = new Set(rows.map((row) => row.id));
  const nonTrashable = permanent ? new Map() : await findNonTrashableIds({ transactionIds: rows.map((row) => row.id) });
  const skippedIds = rows.filter((row) => nonTrashable.has(row.id)).map((row) => row.id);

  for (const row of rows) {
    if (nonTrashable.has(row.id)) continue;
    if (row.transferId && deletedTransferIds.has(row.transferId)) continue;
    if (permanent && row.paymentParentId && !isLinkedLeg(row) && selectedIds.has(row.paymentParentId)) {
      deletedIds.push(row.id);
      continue;
    }

    await deleteTransaction({ id: row.id, userId, permanent });
    deletedIds.push(row.id);

    if (row.transferId) deletedTransferIds.add(row.transferId);
  }

  return { deletedCount: deletedIds.length, deletedIds, skippedIds };
};

export const bulkDelete = withTransaction(bulkDeleteImpl);
