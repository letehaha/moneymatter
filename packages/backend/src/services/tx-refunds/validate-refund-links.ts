import { type RecordId, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { namespace } from '@models/connection';
import RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits from '@models/transaction-splits.model';
import { findTransactions } from '@models/transactions-query';
import Transactions from '@models/transactions.model';
import { Op } from 'sequelize';

import { refundShareAmount } from './refund-share';

const sumShares = ({ links }: { links: RefundTransactions[] }) =>
  Money.sum(links.map((link) => refundShareAmount({ link, refundTx: link.refundTransaction }).abs()));

/**
 * Checks every refund link around `txId`. Each pair must be non-planned, non-transfer and of
 * opposite types, and a link to a purchase outside the app always covers the whole refund. No
 * transaction may be both a refund and a refunded original, so refund-of-refund chains are
 * rejected in either direction. A refund transaction cannot hand out more than its own amount,
 * and a purchase (or split) cannot take back more than it cost from same-currency refunds.
 * Cross-currency links convert at their own dates, so they are never capped.
 */
export const validateRefundLinks = async ({ userId, txId }: { userId: number; txId: string }) => {
  const touching = await RefundTransactions.findAll({
    where: { userId, [Op.or]: [{ refundTxId: txId }, { originalTxId: txId }] },
    attributes: ['refundTxId', 'originalTxId'],
  });
  if (!touching.length) return;

  const refundTxIds = [...new Set(touching.map((link) => link.refundTxId))];
  const originalTxIds = [
    ...new Set(touching.map((link) => link.originalTxId).filter((id): id is RecordId => Boolean(id))),
  ];
  // Both columns for every touched id, so a refund-of-refund chain is visible from either end.
  const touchedTxIds = [...new Set([...refundTxIds, ...originalTxIds])];

  const sequelizeTx = namespace.get('transaction');
  if (!sequelizeTx || sequelizeTx.finished) {
    throw new Error('validateRefundLinks must run inside an open transaction');
  }
  // NO KEY UPDATE: this runs after the link insert, whose FK already holds KEY SHARE on the linked
  // rows, so FOR UPDATE would deadlock two concurrent link writers. Ordered by id so writers lock alike.
  await findTransactions({
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: { id: touchedTxIds },
    order: [['id', 'ASC']],
    transaction: sequelizeTx,
    lock: sequelizeTx.LOCK.NO_KEY_UPDATE,
  });

  const links = await RefundTransactions.findAll({
    where: {
      userId,
      [Op.or]: [{ refundTxId: { [Op.in]: touchedTxIds } }, { originalTxId: { [Op.in]: touchedTxIds } }],
    },
    include: [
      { model: Transactions, as: 'refundTransaction' },
      { model: Transactions, as: 'originalTransaction' },
      { model: TransactionSplits, as: 'split' },
    ],
  });

  for (const link of links) {
    const { refundTransaction: refundTx, originalTransaction: originalTx } = link;

    if (refundTx.isPlanned || originalTx?.isPlanned) {
      throw new ValidationError({ message: t({ key: 'transactions.plannedCannotBeRefundLinked' }) });
    }
    if (originalTx && originalTx.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
      throw new ValidationError({ message: 'Original (non-refund) transaction cannot be transfer one.' });
    }
    if (originalTx && originalTx.transactionType === refundTx.transactionType) {
      throw new ValidationError({
        message: 'Refund transaction must have the opposite transaction type to the original',
      });
    }
    if (refundTx.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer) {
      throw new ValidationError({ message: 'Refund transaction cannot be a transfer one.' });
    }
    if (link.originalTxId === null && link.amount !== null) {
      throw new ValidationError({ message: t({ key: 'transactions.refunds.externalLinkWithAmount' }) });
    }
  }

  const linkedRefundTxIds = new Set(links.map((link) => link.refundTxId));
  if (links.some((link) => link.originalTxId && linkedRefundTxIds.has(link.originalTxId))) {
    throw new ValidationError({ message: t({ key: 'transactions.refunds.refundOfRefund' }) });
  }

  for (const refundTxId of refundTxIds) {
    const group = links.filter((link) => link.refundTxId === refundTxId);
    const refundTx = group[0]!.refundTransaction;

    if (group.length > 1 && group.some((link) => link.originalTxId === null)) {
      throw new ValidationError({ message: t({ key: 'transactions.refunds.externalLinkWithOthers' }) });
    }
    if (group.length > 1 && group.some((link) => link.amount === null)) {
      throw new ValidationError({ message: t({ key: 'transactions.refunds.wholeLinkWithPartials' }) });
    }
    if (sumShares({ links: group }).greaterThan(refundTx.amount.abs())) {
      throw new ValidationError({ message: t({ key: 'transactions.refunds.totalExceedsRefund' }) });
    }
  }

  for (const originalTxId of originalTxIds) {
    const group = links.filter(
      (link) =>
        link.originalTxId === originalTxId &&
        link.originalTransaction.currencyCode === link.refundTransaction.currencyCode,
    );
    if (!group.length) continue;

    const splitIds = new Set(group.map((link) => link.splitId).filter(Boolean));
    for (const splitId of splitIds) {
      const splitGroup = group.filter((link) => link.splitId === splitId);
      if (sumShares({ links: splitGroup }).greaterThan(splitGroup[0]!.split.amount.abs())) {
        throw new ValidationError({ message: t({ key: 'transactions.refunds.totalExceedsSplit' }) });
      }
    }

    if (sumShares({ links: group }).greaterThan(group[0]!.originalTransaction.amount.abs())) {
      throw new ValidationError({ message: t({ key: 'transactions.refunds.totalExceedsOriginal' }) });
    }
  }
};
