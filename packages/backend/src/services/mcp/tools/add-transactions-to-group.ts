import { recordId } from '@common/lib/zod/custom-types';
import { addTransactionsToGroup } from '@services/transaction-groups';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const addTransactionsToGroupTool = defineTool({
  name: 'add_transactions_to_group',
  toolset: 'groups-templates',
  access: 'write',
  description:
    'Add one or more transactions to an existing transaction group. Transfer pairs are auto-included. Returns the updated group with all its transactions.',
  input: {
    groupId: recordId().describe('ID of the transaction group to add transactions to'),
    transactionIds: z.array(recordId()).describe('IDs of transactions to add to the group'),
  },
  run: ({ userId, args }) =>
    addTransactionsToGroup({
      groupId: args.groupId,
      userId,
      transactionIds: args.transactionIds,
    }),
});
