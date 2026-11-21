import { reconciliationIdsBodySchema } from '@controllers/transactions.controller/reconciliation-schemas';
import { keepAsBooked } from '@services/transactions/reconciliation/stuck-pending';

import { defineTool } from '../define-tool';

export const keepPendingAsBookedTool = defineTool({
  name: 'keep_pending_as_booked',
  toolset: 'review',
  access: 'write',
  description:
    'Confirm that bank-synced pending transactions are real and booked, so they stop showing as stuck. Use it for rows from list_stuck_pending_transactions that have no booked twin because the bank still holds the payment. Only pending bank rows are accepted. Returns { updatedIds }.',
  input: {
    transactionIds: reconciliationIdsBodySchema.shape.transactionIds.describe(
      'IDs of the pending transactions to keep as booked (1 to 500, no repeats)',
    ),
  },
  run: ({ userId, args }) => keepAsBooked({ userId, transactionIds: args.transactionIds }),
});
