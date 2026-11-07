import { recordId } from '@common/lib/zod/custom-types';
import { deleteTransactionGroup } from '@services/transaction-groups';

import { defineTool } from '../define-tool';

export const deleteTransactionGroupTool = defineTool({
  name: 'delete_transaction_group',
  toolset: 'groups-templates',
  access: 'delete',
  description:
    'Permanently delete a transaction group. The transactions themselves are NOT deleted — only the grouping is removed. This action cannot be undone.',
  input: {
    id: recordId().describe('ID of the transaction group to delete'),
  },
  run: ({ userId, args }) => deleteTransactionGroup({ id: args.id, userId }),
});
