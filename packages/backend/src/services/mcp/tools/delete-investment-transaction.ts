import { deleteInvestmentTransaction } from '@services/investments/transactions/delete.service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const deleteInvestmentTransactionTool = defineTool({
  name: 'delete_investment_transaction',
  toolset: 'investments',
  access: 'delete',
  description:
    'Permanently delete an investment transaction. The holding and portfolio cash balance are automatically recalculated after deletion. This action is irreversible — confirm with the user before calling. Obtain transactionId from get_investment_transactions.',
  input: {
    transactionId: z.string().uuid().describe('Investment transaction ID to delete (from get_investment_transactions)'),
  },
  run: ({ userId, args }) =>
    deleteInvestmentTransaction({
      userId,
      transactionId: args.transactionId,
    }),
});
