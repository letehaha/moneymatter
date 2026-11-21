import type { RecordId } from '@bt/shared/types';
import RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits from '@models/transaction-splits.model';

// Keyed by category alone: callers verify the category is theirs, and on a shared account
// the split rows can carry a recipient's userId.
export const repointSplits = async ({ from, to }: { from: RecordId; to: RecordId }) => {
  const splits = await TransactionSplits.findAll({ where: { categoryId: from } });
  if (!splits.length) return;

  // UNIQUE(transactionId, categoryId): a transaction already split into the target absorbs
  // the source split's money and refunds rather than gaining a second row.
  const keepers = await TransactionSplits.findAll({
    where: { categoryId: to, transactionId: splits.map((split) => split.transactionId) },
  });
  const keeperByTransactionId = new Map(keepers.map((keeper) => [keeper.transactionId, keeper]));

  for (const split of splits) {
    const keeper = keeperByTransactionId.get(split.transactionId);
    if (!keeper) continue;

    await keeper.update({
      amount: keeper.amount.add(split.amount),
      refAmount: keeper.refAmount.add(split.refAmount),
      note: keeper.note ?? split.note,
    });
    await RefundTransactions.update({ splitId: keeper.id }, { where: { splitId: split.id } });
    await split.destroy();
  }

  await TransactionSplits.update({ categoryId: to }, { where: { categoryId: from } });
};
