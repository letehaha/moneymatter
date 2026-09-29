import { isLinkedTransfer } from '@bt/shared/const/transfers';
import { ACCOUNT_TYPES, RecordId, SUBSCRIPTION_LINK_STATUS } from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import BudgetTransactions from '@models/budget-transactions.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import TransactionGroupItems from '@models/transaction-group-items.model';
import { dissolveUndersizedGroups } from '@models/transaction-groups.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import type Transactions from '@models/transactions.model';
import { Op } from 'sequelize';

export const rejectIfAny = ({ rows, key }: { rows: Transactions[]; key: string }) => {
  if (rows.length === 0) return;
  throw new ValidationError({ message: t({ key }), details: { transactionIds: rows.map((row) => row.id) } });
};

export const loadReconcilableRows = async ({
  userId,
  transactionIds,
}: {
  userId: number;
  transactionIds: RecordId[];
}): Promise<Transactions[]> => {
  // Row lock serializes concurrent merges of the same rows; the loser re-reads them as deleted and 404s.
  const rows = await findTransactions({
    where: { id: { [Op.in]: transactionIds } },
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    lock: true,
  });

  if (rows.length !== transactionIds.length) {
    throw new NotFoundError({ message: t({ key: 'transactions.notFound' }) });
  }

  rejectIfAny({
    rows: rows.filter((row) => row.accountType === ACCOUNT_TYPES.system),
    key: 'transactions.reconciliation.systemNotAllowed',
  });
  rejectIfAny({ rows: rows.filter((row) => row.isPlanned), key: 'transactions.reconciliation.plannedNotAllowed' });
  rejectIfAny({
    rows: rows.filter((tx) => isLinkedTransfer({ tx })),
    key: 'transactions.reconciliation.transferNotAllowed',
  });
  rejectIfAny({ rows: rows.filter((row) => row.refundLinked), key: 'transactions.reconciliation.refundNotAllowed' });

  return rows;
};

export const detachLinks = async ({ transactionIds }: { transactionIds: RecordId[] }) => {
  const where = { transactionId: { [Op.in]: transactionIds } };

  const groupItems = await TransactionGroupItems.findAll({ where, attributes: ['groupId'] });

  await Promise.all([
    BudgetTransactions.destroy({ where }),
    TransactionGroupItems.destroy({ where }),
    // `unlinked` markers stay so a restored row is not auto-matched back to a subscription the user unlinked.
    SubscriptionTransactions.destroy({ where: { ...where, status: SUBSCRIPTION_LINK_STATUS.active } }),
    SubscriptionPeriods.update({ transactionId: null, transactionAutoCreated: false }, { where }),
  ]);

  await dissolveUndersizedGroups({ groupIds: [...new Set(groupItems.map((item) => item.groupId))] });
};

// Hooks stay off: provider balances are bank-authoritative, so hiding a row moves no balance.
export const softDeleteTransactions = ({
  userId,
  transactionIds,
  mergedIntoId,
}: {
  userId: number;
  transactionIds: RecordId[];
  mergedIntoId: RecordId | null;
}) =>
  updateTransactions({
    values: { deletedAt: new Date(), mergedIntoId },
    where: { id: { [Op.in]: transactionIds } },
    planned: 'exclude',
    access: { creator: userId },
    balanceAdjustments: 'include',
  });
