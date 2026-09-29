import type { RecordId } from '@bt/shared/types';
import TransactionSplits from '@models/transaction-splits.model';
import { countTransactions } from '@models/transactions-query';
import { Op } from 'sequelize';

// Shared by the delete guard and the count endpoint that drives the reassign prompt, so the
// two cannot disagree. A split row is ON DELETE CASCADE, so a transaction that only carries
// a split for the category has to block the delete too or its split silently disappears.
export const countCategoryTransactions = async ({ categoryId, userId }: { categoryId: RecordId; userId: number }) => {
  const splits = await TransactionSplits.findAll({ where: { categoryId }, attributes: ['transactionId'] });
  // Counted regardless of creator: on a shared account a recipient's transaction can carry
  // a split for the owner's category.
  const splitTransactionIds = [...new Set(splits.map((split) => split.transactionId))];

  const filedUnderCategory = await countTransactions({
    where: splitTransactionIds.length ? { categoryId, id: { [Op.notIn]: splitTransactionIds } } : { categoryId },
    planned: 'include',
    access: { creator: userId },
    balanceAdjustments: 'include',
    paranoid: false,
  });

  return filedUnderCategory + splitTransactionIds.length;
};
