import { recordId } from '@common/lib/zod/custom-types';
import { deleteTransaction } from '@services/transactions/delete-transaction';

import { defineTool } from '../define-tool';

export const deleteTransactionTool = defineTool({
  name: 'delete_transaction',
  toolset: 'core',
  access: 'delete',
  description:
    'Move a transaction to Trash by ID. It is hidden everywhere and balances are reversed; the user can restore it in the app within 30 days, after which it is deleted for good. For transfer transactions, both sides of the transfer go to Trash. Rejected for transactions that belong to a payment, a portfolio or a venture: they must be unlinked first.',
  input: {
    id: recordId().describe('ID of the transaction to delete'),
  },
  run: async ({ userId, args }) => {
    await deleteTransaction({ id: args.id, userId });

    return { deleted: true, id: args.id };
  },
});
