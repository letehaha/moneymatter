import { reconciliationIdsBodySchema } from '@controllers/transactions.controller/reconciliation-schemas';
import { removeTransactions } from '@services/transactions/reconciliation/remove-transactions';

import { defineTool } from '../define-tool';

export const removeDuplicateTransactionsTool = defineTool({
  name: 'remove_duplicate_transactions',
  toolset: 'review',
  access: 'delete',
  description:
    'Remove duplicate transactions from the books: they disappear from lists, trackers and reports, and the account balance is left as it is. The rows are soft-deleted, so restore_removed_transactions brings them back, but a restored row does not get back the budget, group or subscription links removed with it. Use it for a pending bank row that the booked row replaced (see list_stuck_pending_transactions) or any other duplicate you want to drop and keep the other copy as it is; to keep the links of the dropped rows, merge them with merge_duplicate_transactions instead. Planned rows, transfers, refund-linked rows and system-account rows are refused. Returns { removedIds }. DESTRUCTIVE.',
  input: {
    transactionIds: reconciliationIdsBodySchema.shape.transactionIds.describe(
      'IDs of the transactions to remove (1 to 500, no repeats)',
    ),
  },
  run: ({ userId, args }) => removeTransactions({ userId, transactionIds: args.transactionIds }),
});
