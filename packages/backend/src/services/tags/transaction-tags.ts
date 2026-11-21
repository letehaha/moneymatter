import type { RecordId } from '@bt/shared/types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import Tags from '@models/tags.model';
import TransactionTags from '@models/transaction-tags.model';
import { findTransactions } from '@models/transactions-query';
import { DOMAIN_EVENTS, eventBus } from '@services/common/event-bus';
import { withTransaction } from '@services/common/with-transaction';
import { syncLegsOfMains } from '@services/transactions/payment-legs';
import { Op } from 'sequelize';

interface AddTransactionsToTagPayload {
  tagId: RecordId;
  userId: number;
  transactionIds: RecordId[];
}

export const addTransactionsToTag = withTransaction(async (payload: AddTransactionsToTagPayload) => {
  const { tagId, userId, transactionIds } = payload;

  await findOrThrowNotFound({
    query: Tags.findOne({ where: { id: tagId, userId } }),
    message: t({ key: 'tags.tagNotFound' }),
  });

  const transactions = await findTransactions({
    // Tags attach to planned rows too, so the ownership check spans both kinds.
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: {
      id: { [Op.in]: transactionIds },
    },
  });

  if (transactions.length !== transactionIds.length) {
    throw new ValidationError({ message: t({ key: 'tags.someTransactionIdsInvalid' }) });
  }
  // A leg's tags mirror its main row, so the write lands on the main and syncs down.
  const mainIds = [...new Set(transactions.map((tx) => tx.paymentParentId ?? tx.id))];

  // Filter out transactions that are already tagged
  const existingLinks = await TransactionTags.findAll({
    where: {
      tagId,
      transactionId: { [Op.in]: mainIds },
    },
  });

  const existingTransactionIds = new Set(existingLinks.map((link) => link.transactionId));
  const newTransactionIds = mainIds.filter((id) => !existingTransactionIds.has(id));

  if (newTransactionIds.length > 0) {
    const transactionTags = newTransactionIds.map((transactionId) => ({
      tagId,
      transactionId,
    }));

    await TransactionTags.bulkCreate(transactionTags);
    await syncLegsOfMains({ mainIds: newTransactionIds });

    // Emit event for real-time reminders check (handled by event listener)
    eventBus.emit(DOMAIN_EVENTS.TRANSACTIONS_TAGGED, { tagIds: [tagId], userId });
  }

  return {
    message: t({ key: 'tags.transactionsAddedSuccessfully' }),
    addedCount: newTransactionIds.length,
    skippedCount: mainIds.length - newTransactionIds.length,
  };
});

interface RemoveTransactionsFromTagPayload {
  tagId: string;
  userId: number;
  transactionIds: string[];
}

export const removeTransactionsFromTag = withTransaction(async (payload: RemoveTransactionsFromTagPayload) => {
  const { tagId, userId, transactionIds } = payload;

  await findOrThrowNotFound({
    query: Tags.findOne({ where: { id: tagId, userId } }),
    message: t({ key: 'tags.tagNotFound' }),
  });

  // Verify transactions belong to user
  const transactions = await findTransactions({
    // Tags attach to planned rows too, so the ownership check spans both kinds.
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    completeness: 'all',
    where: {
      id: { [Op.in]: transactionIds },
    },
  });

  if (transactions.length !== transactionIds.length) {
    throw new ValidationError({ message: t({ key: 'tags.someTransactionIdsInvalid' }) });
  }
  const mainIds = [...new Set(transactions.map((tx) => tx.paymentParentId ?? tx.id))];

  const deletedCount = await TransactionTags.destroy({
    where: {
      tagId,
      transactionId: { [Op.in]: mainIds },
    },
  });
  await syncLegsOfMains({ mainIds });

  return {
    message: t({ key: 'tags.transactionsRemovedSuccessfully' }),
    removedCount: deletedCount,
  };
});
