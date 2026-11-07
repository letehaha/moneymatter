import type { serializeRefundTransaction } from '@root/serializers/refund-transactions.serializer';

import { presentTransactions } from './transaction-output';

/**
 * Refund links as an assistant reads them: the link ids, and both transactions slimmed with
 * their payee. One name lookup serves every transaction of the page.
 */
type RefundApiResponse = ReturnType<typeof serializeRefundTransaction>;

export async function presentRefunds({ userId, refunds }: { userId: number; refunds: RefundApiResponse[] }) {
  const transactions = refunds.flatMap((refund) =>
    [refund.originalTransaction, refund.refundTransaction].filter((tx) => tx !== undefined),
  );
  const slimById = new Map((await presentTransactions({ userId, transactions })).map((tx) => [tx.id, tx]));

  return refunds.map((refund) => ({
    id: refund.id,
    originalTxId: refund.originalTxId,
    refundTxId: refund.refundTxId,
    splitId: refund.splitId,
    originalTransaction: refund.originalTransaction ? (slimById.get(refund.originalTransaction.id) ?? null) : null,
    refundTransaction: refund.refundTransaction ? (slimById.get(refund.refundTransaction.id) ?? null) : null,
  }));
}
