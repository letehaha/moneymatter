import { ACCOUNT_TYPES, isLinkedTransfer } from '@bt/shared/types';
import Accounts from '@models/accounts.model';
import RefundTransactions from '@models/refund-transactions.model';
import { findTransactions } from '@models/transactions-query';
import { reconciliationRemovedWhere } from '@models/transactions-query/deletion-where';
import type Transactions from '@models/transactions.model';
import { Op } from 'sequelize';

import { hashTargetIds, latestUpdatedAt } from '../snapshot';
import {
  assertConcreteTargets,
  forUpdate,
  keepVisibleRows,
  loadUserTransactions,
  PreviewError,
  serializeRow,
  TRANSACTION_SAMPLE_ATTRIBUTES,
  targetNotFound,
  transactionsAffected,
} from './preview-helpers';
import type { PreviewResolver } from './types';

/**
 * Both reconciliation services refuse rows of a manual account, planned rows, transfers and rows with
 * a refund link. A refund link is read from the link rows, since the flag on a row is off while the
 * other side of the link sits in Trash.
 */
const findRefused = async ({ rows }: { rows: Transactions[] }): Promise<Transactions[]> => {
  const ids = rows.map((row) => row.id);
  const refundLinks = await RefundTransactions.findAll({
    where: { [Op.or]: [{ originalTxId: { [Op.in]: ids } }, { refundTxId: { [Op.in]: ids } }] },
    attributes: ['originalTxId', 'refundTxId'],
  });
  const refundLinked = new Set(refundLinks.flatMap((link) => [link.originalTxId, link.refundTxId]));

  return rows.filter(
    (row) =>
      row.accountType === ACCOUNT_TYPES.system ||
      row.isPlanned ||
      isLinkedTransfer({ tx: row }) ||
      refundLinked.has(row.id),
  );
};

async function loadDuplicates({
  userId,
  ids,
  lock,
}: {
  userId: number;
  ids: string[];
  lock?: boolean;
}): Promise<Transactions[]> {
  assertConcreteTargets({ value: ids, what: 'transactions' });

  const rows = await loadUserTransactions({ userId, ids, lock });
  if (rows.length !== ids.length) throw targetNotFound({ what: 'transactions' });

  if ((await findRefused({ rows })).length > 0) {
    throw new PreviewError({
      messageKey: 'chat.cards.reconciliationRefused',
      message:
        'Rows of a manual account, planned rows, transfers and refund-linked rows cannot be removed or merged as duplicates',
    });
  }
  return rows;
}

const snapshotOf = ({ rows }: { rows: Transactions[] }) => ({
  updatedAt: latestUpdatedAt({ dates: rows.map((row) => row.updatedAt) }),
  targetHash: hashTargetIds({ ids: rows.map((row) => row.id) }),
  targetCount: rows.length,
});

/**
 * Removes the listed rows from the books (soft delete): the card counts exactly those rows, and
 * lists the ones on accounts the user can still see.
 */
export const resolveRemoveDuplicateTransactions: PreviewResolver = async ({ userId, args, lock }) => {
  const rows = await loadDuplicates({ userId, ids: [...new Set(args.transactionIds as string[])], lock });

  return {
    preview: { affected: transactionsAffected({ rows: await keepVisibleRows({ userId, rows }), count: rows.length }) },
    snapshot: snapshotOf({ rows }),
    affectedCount: rows.length,
  };
};

/** Merges duplicates into the survivor, which stays as it is: the card shows it, and lists the rows that go. */
export const resolveMergeDuplicateTransactions: PreviewResolver = async ({ userId, args, lock }) => {
  const survivorId = args.survivorId as string;
  const rows = await loadDuplicates({ userId, ids: [...new Set(args.transactionIds as string[])], lock });

  const survivor = rows.find((row) => row.id === survivorId);
  if (!survivor) throw targetNotFound({ what: 'surviving transaction' });
  const removed = rows.filter((row) => row.id !== survivorId);
  const survivorVisible = (await keepVisibleRows({ userId, rows: [survivor] })).length > 0;

  return {
    preview: {
      ...(survivorVisible ? { before: serializeRow({ row: survivor }) } : {}),
      affected: transactionsAffected({ rows: await keepVisibleRows({ userId, rows: removed }), count: removed.length }),
    },
    snapshot: snapshotOf({ rows }),
    affectedCount: removed.length,
  };
};

/**
 * Brings rows a duplicate removal or merge took out of the books back. The service refuses the whole
 * call for an id that is not such a row of the user, and for a row whose account was disconnected
 * from its bank since; the card is refused the same way. It lists the rows that come back, which
 * come back without the budget, group and subscription links they lost.
 */
export const resolveRestoreRemovedTransactions: PreviewResolver = async ({ userId, args, lock }) => {
  const ids = [...new Set(args.transactionIds as string[])];
  assertConcreteTargets({ value: ids, what: 'transactions' });

  const rows = await findTransactions({
    ...forUpdate({ lock }),
    where: { id: { [Op.in]: ids }, deletedAt: { [Op.ne]: null }, ...reconciliationRemovedWhere },
    paranoid: false,
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    attributes: TRANSACTION_SAMPLE_ATTRIBUTES,
    order: [
      ['time', 'DESC'],
      ['id', 'DESC'],
    ],
  });
  if (rows.length !== ids.length) throw targetNotFound({ what: 'removed transactions' });

  const accounts = await Accounts.findAll({
    where: { id: { [Op.in]: [...new Set(rows.map((row) => row.accountId))] }, userId },
    attributes: ['id', 'type'],
  });
  const accountTypes = new Map(accounts.map((account) => [account.id, account.type]));
  if (rows.some((row) => accountTypes.get(row.accountId) !== row.accountType)) {
    throw new PreviewError({
      messageKey: 'chat.cards.restoreAccountDisconnected',
      message: 'The account of a removed transaction was disconnected from its bank, so it cannot be restored',
    });
  }

  return {
    preview: {
      affected: transactionsAffected({ rows: await keepVisibleRows({ userId, rows }), count: rows.length }),
      counts: { transactionCount: rows.length },
    },
    snapshot: snapshotOf({ rows }),
    affectedCount: rows.length,
    warnings: [{ key: 'chat.warnings.restoredWithoutLinks', params: { count: rows.length } }],
  };
};
