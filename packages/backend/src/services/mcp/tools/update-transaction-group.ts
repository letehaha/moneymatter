import { recordId } from '@common/lib/zod/custom-types';
import { updateTransactionGroup } from '@services/transaction-groups';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const updateTransactionGroupTool = defineTool({
  name: 'update_transaction_group',
  toolset: 'groups-templates',
  access: 'write',
  description:
    'Update the name or note of an existing transaction group. To change group membership use add_transactions_to_group or remove_transactions_from_group.',
  input: {
    id: recordId().describe('ID of the transaction group to update'),
    name: z.string().optional().describe('New display name for the group'),
    note: z.string().max(500).nullable().optional().describe('New note for the group (pass null to clear)'),
  },
  run: ({ userId, args }) =>
    updateTransactionGroup({
      id: args.id,
      userId,
      name: args.name,
      note: args.note,
    }),
});
