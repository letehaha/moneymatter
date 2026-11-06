import { getStuckPending } from '@services/transactions/reconciliation/stuck-pending';

import { defineTool } from '../define-tool';
import { presentTransactions } from './transaction-output';

export const listStuckPendingTransactionsTool = defineTool({
  name: 'list_stuck_pending_transactions',
  toolset: 'review',
  access: 'read',
  description:
    'List bank-synced transactions that have been pending for more than 7 days, so the bank probably booked them under a different row. Returns { pending: [{ transaction, candidate, pendingDays }] }: candidate is the booked transaction that most likely replaced the pending one, or null. When the candidate is the same purchase, remove the pending row with remove_duplicate_transactions or merge both with merge_duplicate_transactions; when the bank really still holds the payment, confirm the row with keep_pending_as_booked. Transfers and refund-linked rows are not listed.',
  run: async ({ userId }) => {
    const items = await getStuckPending({ userId });

    // One name lookup serves every transaction and candidate; slim rows are matched back by id.
    const apiRows = items.flatMap((item) => (item.candidate ? [item.transaction, item.candidate] : [item.transaction]));
    const slimById = new Map((await presentTransactions({ userId, transactions: apiRows })).map((tx) => [tx.id, tx]));

    const pending = items.map((item) => ({
      transaction: slimById.get(item.transaction.id),
      candidate: item.candidate ? slimById.get(item.candidate.id) : null,
      pendingDays: item.pendingDays,
    }));

    return { pending };
  },
});
