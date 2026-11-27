import { ACCOUNT_TYPES, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { roundToCurrency } from '@common/lib/currency-precision';
import { Money } from '@common/types/money';
import type Accounts from '@models/accounts.model';
import RefundTransactions from '@models/refund-transactions.model';
import SubscriptionPeriods from '@models/subscription-periods.model';
import SubscriptionTransactions from '@models/subscription-transactions.model';
import { findTransactions, updateTransactions } from '@models/transactions-query';
import { reconciliationRemovedWhere } from '@models/transactions-query/deletion-where';
import type Transactions from '@models/transactions.model';
import { getLinkDayStart } from '@services/accounts/seam';
import { calculateRefAmount } from '@services/calculate-ref-amount.service';
import { findNonTrashableIds } from '@services/transactions/trash/find-non-trashable-ids';
import { Op } from 'sequelize';

import type { SyncedTransactionRow } from '../types';
import { persistSyncedTransactions } from '../utils/persist-synced-transactions';
import type { PlaidSyncDelta } from './api-client';
import { normalizePlaidTransaction } from './normalize';

const findProtectedIds = async ({ transactionIds }: { transactionIds: string[] }) => {
  if (!transactionIds.length) return new Set<string>();
  const inIds = { [Op.in]: transactionIds };
  const [nonTrashable, refunds, subscriptions, periods] = await Promise.all([
    findNonTrashableIds({ transactionIds }),
    RefundTransactions.findAll({
      where: { [Op.or]: [{ originalTxId: inIds }, { refundTxId: inIds }] },
      attributes: ['originalTxId', 'refundTxId'],
    }),
    SubscriptionTransactions.findAll({ where: { transactionId: inIds }, attributes: ['transactionId'] }),
    SubscriptionPeriods.findAll({ where: { transactionId: inIds }, attributes: ['transactionId'] }),
  ]);
  const result = new Set(nonTrashable.keys());
  for (const refund of refunds) {
    result.add(refund.refundTxId);
    if (refund.originalTxId) result.add(refund.originalTxId);
  }
  for (const subscription of subscriptions) result.add(subscription.transactionId);
  for (const { transactionId } of periods) if (transactionId) result.add(transactionId);
  return result;
};

const applyModification = async ({ row, update }: { row: Transactions; update: SyncedTransactionRow }) => {
  const signedAmount = Money.fromDecimal(update.amount);
  const amount = await roundToCurrency({
    money: signedAmount.abs(),
    userId: row.userId,
    currencyCode: row.currencyCode,
    mode: 'half-up',
  });
  const transactionType = signedAmount.isNegative() ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income;
  if (
    row.amount.equals(amount) &&
    row.time.getTime() === update.time.getTime() &&
    row.transactionType === transactionType
  )
    return;
  const refAmount = await calculateRefAmount({
    amount,
    userId: row.userId,
    definitionOwnerUserId: row.userId,
    date: update.time,
    baseCode: row.currencyCode,
    quoteCode: row.refCurrencyCode,
  });
  // Note, category, payee and other user annotations are not owned by the feed.
  await row.update({ amount, refAmount, time: update.time, transactionType });
};

export const applyPlaidChanges = async ({
  account,
  externalId,
  changes,
  hasCursor,
  checkpoint,
}: {
  account: Accounts;
  externalId: string;
  changes: PlaidSyncDelta;
  hasCursor: boolean;
  checkpoint: () => Promise<void>;
}): Promise<string[]> => {
  const userId = account.userId;
  const linkDayStart = getLinkDayStart({ externalData: account.externalData });
  const removed = new Set<string>();
  for (const row of changes.removed) {
    // Item-wide removals may omit the account id; the scoped lookup below is authoritative.
    if (row.account_id === undefined || row.account_id === externalId) removed.add(row.transaction_id);
  }

  const inserts = new Map<string, SyncedTransactionRow>();
  const modified = new Map<string, SyncedTransactionRow>();
  for (const [target, transactions] of [
    [inserts, changes.added],
    [modified, changes.modified],
  ] as const) {
    for (const transaction of transactions) {
      if (transaction.account_id !== externalId || removed.has(transaction.transaction_id)) continue;
      const normalized = normalizePlaidTransaction({ transaction, accountCurrency: account.currencyCode });
      if (normalized) target.set(normalized.originalId, normalized);
    }
  }

  if (removed.size || modified.size) {
    const existing = await findTransactions({
      where: { accountId: account.id, originalId: { [Op.in]: [...removed, ...modified.keys()] } },
      access: { creator: userId },
      planned: 'exclude',
      balanceAdjustments: 'include',
      completeness: 'all',
      paranoid: false,
      lock: true,
      order: [['id', 'ASC']],
    });
    const mutable: Transactions[] = [];
    for (const row of existing) {
      // Existing rows, including tombstones and manually reconciled rows, are never re-created.
      inserts.delete(row.originalId);
      if (
        !row.deletedAt &&
        row.accountType === ACCOUNT_TYPES.plaid &&
        row.externalData?.plaidAccountId === externalId &&
        !row.externalData.balanceAdjustment &&
        row.transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer &&
        (!linkDayStart || row.time >= linkDayStart)
      )
        mutable.push(row);
    }

    const protectedIds = await findProtectedIds({ transactionIds: mutable.map((row) => row.id) });
    const deleteIds: string[] = [];
    for (const row of mutable) {
      await checkpoint();
      if (protectedIds.has(row.id)) continue;
      if (removed.has(row.originalId)) {
        deleteIds.push(row.id);
      } else {
        const update = modified.get(row.originalId);
        if (update && (!linkDayStart || update.time >= linkDayStart)) await applyModification({ row, update });
      }
    }
    if (deleteIds.length) {
      // Keep provider ids as dedup tombstones without discarding local links or changing bank-owned balances.
      await updateTransactions({
        where: { id: { [Op.in]: deleteIds }, accountId: account.id },
        values: { deletedAt: new Date(), ...reconciliationRemovedWhere },
        access: { creator: userId },
        planned: 'exclude',
        balanceAdjustments: 'exclude',
        hooks: false,
      });
    }

    for (const row of existing) modified.delete(row.originalId);
    // Plaid can modify a row we never imported (e.g. when a pending row clears).
    for (const [id, row] of modified) inserts.set(id, row);
  }

  if (!inserts.size) return [];
  const result = await persistSyncedTransactions({
    account,
    userId,
    accountType: ACCOUNT_TYPES.plaid,
    rows: Array.from(inserts.values()).sort((left, right) => left.time.getTime() - right.time.getTime()),
    matchPlanned: hasCursor || linkDayStart !== null,
    createFromDate: linkDayStart ?? undefined,
    checkpoint,
  });
  return result.createdTransactionIds;
};
