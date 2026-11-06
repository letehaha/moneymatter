import { reconciliationIdsBodySchema } from '@controllers/transactions.controller/reconciliation-schemas';
import { restoreTransactions } from '@services/transactions/reconciliation/restore-transactions';

import { defineTool } from '../define-tool';

export const restoreRemovedTransactionsTool = defineTool({
  name: 'restore_removed_transactions',
  toolset: 'review',
  access: 'write',
  description:
    'Bring back transactions that remove_duplicate_transactions or merge_duplicate_transactions took out of the books. Find the ids in get_reconciliation_history. A restored row comes back as it was but without the budget, group and subscription links it lost when it was removed or merged. Refused when the account of a row was disconnected from the bank in the meantime. Returns { restoredIds }.',
  input: {
    transactionIds: reconciliationIdsBodySchema.shape.transactionIds.describe(
      'IDs of the removed transactions to restore (1 to 500, no repeats)',
    ),
  },
  run: ({ userId, args }) => restoreTransactions({ userId, transactionIds: args.transactionIds }),
});
