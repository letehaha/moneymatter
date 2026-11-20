import { reconciliationMergeBodySchema } from '@controllers/transactions.controller/reconciliation-schemas';
import { mergeTransactions } from '@services/transactions/reconciliation/merge-transactions';

import { defineTool } from '../define-tool';

export const mergeDuplicateTransactionsTool = defineTool({
  name: 'merge_duplicate_transactions',
  toolset: 'review',
  access: 'write',
  description:
    'Merge duplicate transactions of one account into a survivor: the other rows are removed and their tracker, group and subscription links move to the survivor, which keeps its own data. The removed rows are soft-deleted, so restore_removed_transactions brings them back, but a restored row does not get its links back (they stay on the survivor). Planned rows, transfers, refund-linked rows and system-account rows are refused, as is a merge whose rows link to different budgets, groups or subscriptions than the survivor can take. Returns { removedIds }, the merged rows.',
  input: {
    transactionIds: reconciliationMergeBodySchema.shape.transactionIds.describe(
      'IDs of the duplicate transactions, the survivor included (2 to 4, no repeats, all on the same account)',
    ),
    survivorId: reconciliationMergeBodySchema.shape.survivorId.describe(
      'ID of the transaction to keep; it must be one of transactionIds',
    ),
  },
  run: ({ userId, args }) =>
    mergeTransactions({
      userId,
      transactionIds: args.transactionIds,
      survivorId: args.survivorId,
    }),
});
