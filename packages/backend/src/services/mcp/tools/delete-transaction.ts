import { recordId } from '@common/lib/zod/custom-types';
import { deleteTransaction } from '@services/transactions/delete-transaction';

import { defineTool } from '../define-tool';

export const deleteTransactionTool = defineTool({
  name: 'delete_transaction',
  toolset: 'core',
  access: 'delete',
  description:
    'Permanently delete a transaction by ID. DESTRUCTIVE: this cannot be undone. For transfer transactions, both sides of the transfer are deleted.',
  input: {
    id: recordId().describe('ID of the transaction to delete'),
  },
  run: async ({ userId, args }) => {
    await deleteTransaction({ id: args.id, userId });

    return { deleted: true, id: args.id };
  },
});
