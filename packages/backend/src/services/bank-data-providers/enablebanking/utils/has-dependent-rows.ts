import type Transactions from '@models/transactions.model';
import { findIdsInPayments } from '@services/transactions/payment-legs';

export async function hasDependentRows({ tx }: { tx: Transactions }): Promise<boolean> {
  if (tx.transferId) return true;
  if (tx.refundLinked) return true;
  if ((await findIdsInPayments({ transactionIds: [tx.id] })).length) return true;

  // Loaded lazily to avoid a circular import wave at module load.
  const TransactionTags = (await import('@models/transaction-tags.model')).default;
  const TransactionSplits = (await import('@models/transaction-splits.model')).default;
  const RefundTransactions = (await import('@models/refund-transactions.model')).default;
  const TrackerTransactions = (await import('@models/tracker-transactions.model')).default;
  const SubscriptionTransactions = (await import('@models/subscription-transactions.model')).default;
  const TransactionGroupItems = (await import('@models/transaction-group-items.model')).default;

  const transactionId = tx.id;
  const counts = await Promise.all([
    TransactionTags.count({ where: { transactionId } }),
    TransactionSplits.count({ where: { transactionId } }),
    RefundTransactions.count({ where: { originalTxId: transactionId } }),
    RefundTransactions.count({ where: { refundTxId: transactionId } }),
    TrackerTransactions.count({ where: { transactionId } }),
    SubscriptionTransactions.count({ where: { transactionId } }),
    TransactionGroupItems.count({ where: { transactionId } }),
  ]);

  return counts.some((count) => count > 0);
}
