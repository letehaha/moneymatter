import { recordId } from '@common/lib/zod/custom-types';
import { removeTransactionsFromGroup } from '@services/transaction-groups';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const removeTransactionsFromGroupTool = defineTool({
  name: 'remove_transactions_from_group',
  toolset: 'groups-templates',
  access: 'write',
  description:
    'Remove transactions from a group. If removal would leave fewer than 2 transactions, pass force=true to dissolve the group entirely (transactions are kept).',
  input: {
    groupId: recordId().describe('ID of the transaction group'),
    transactionIds: z.array(recordId()).describe('IDs of transactions to remove from the group'),
    force: z
      .boolean()
      .optional()
      .describe(
        'When true, dissolves the group if too few transactions would remain. Default: false (returns error instead)',
      ),
  },
  run: ({ userId, args }) =>
    removeTransactionsFromGroup({
      groupId: args.groupId,
      userId,
      transactionIds: args.transactionIds,
      force: args.force,
    }),
});
