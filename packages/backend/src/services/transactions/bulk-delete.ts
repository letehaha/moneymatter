import { ACCOUNT_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Accounts from '@models/accounts.model';
import * as Transactions from '@models/transactions.model';
import { Op } from 'sequelize';

import { withTransaction } from '../common/with-transaction';
import { deleteTransaction } from './delete-transaction';

interface BulkDeleteParams {
  userId: number;
  transactionIds: string[];
}

interface BulkDeleteResult {
  deletedCount: number;
  deletedIds: string[];
}

/**
 * Deletes a set of transactions in a single DB transaction (all-or-nothing).
 *
 * Rows on a bank-linked account (account type !== system) are rejected up-front with a
 * structured error listing the offending ids — the API must enforce this
 * regardless of what the client sends, since external transactions are owned
 * by the bank sync and deleting them would desync balances on the next sync.
 * A plan on a provider account is exempt: the bank has never reported it, so
 * deleting it takes nothing away from the sync.
 *
 * Each row goes through `deleteTransaction`, which handles per-row write
 * authorization, transfer-pair cleanup, refund unlinking, and portfolio
 * transfer reversal. When a common-transfer leg is deleted its twin goes with
 * it, so a twin that was also selected is skipped instead of failing with 404.
 */
const bulkDeleteImpl = async ({ userId, transactionIds }: BulkDeleteParams): Promise<BulkDeleteResult> => {
  const uniqueIds = [...new Set(transactionIds)];

  const rows = (await Transactions.default.findAll({
    where: { id: { [Op.in]: uniqueIds }, userId },
    attributes: ['id', 'accountId', 'transferId', 'isPlanned'],
    raw: true,
  })) as unknown as Array<{
    id: string;
    accountId: string;
    transferId: string | null;
    isPlanned: boolean;
  }>;

  if (rows.length === 0) {
    throw new NotFoundError({ message: 'No valid transactions found' });
  }

  const bankLinkedAccounts = await Accounts.findAll({
    where: { id: { [Op.in]: rows.map((row) => row.accountId) }, type: { [Op.ne]: ACCOUNT_TYPES.system } },
    attributes: ['id'],
  });
  const bankLinkedAccountIds = new Set<string>(bankLinkedAccounts.map((account) => account.id));

  const disallowedIds = rows
    .filter((row) => bankLinkedAccountIds.has(row.accountId) && !row.isPlanned)
    .map((row) => row.id);
  if (disallowedIds.length > 0) {
    throw new ValidationError({
      message: t({ key: 'transactions.cannotDeleteExternal' }),
      details: { disallowedIds },
    });
  }

  const deletedIds: string[] = [];
  const deletedTransferIds = new Set<string>();

  for (const row of rows) {
    if (row.transferId && deletedTransferIds.has(row.transferId)) continue;

    await deleteTransaction({ id: row.id, userId });
    deletedIds.push(row.id);

    if (row.transferId) deletedTransferIds.add(row.transferId);
  }

  return { deletedCount: deletedIds.length, deletedIds };
};

export const bulkDelete = withTransaction(bulkDeleteImpl);
