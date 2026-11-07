import { recordId } from '@common/lib/zod/custom-types';
import { createTransactionGroup } from '@services/transaction-groups';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const createTransactionGroupTool = defineTool({
  name: 'create_transaction_group',
  toolset: 'groups-templates',
  access: 'write',
  description:
    'Create a new transaction group that bundles related transactions together (e.g. a split bill). Requires at least 2 transactions. Transfer pairs are automatically included.',
  input: {
    name: z.string().describe('Display name for the group'),
    transactionIds: z.array(recordId()).describe('IDs of transactions to include in the group (minimum 2, maximum 50)'),
    note: z.string().max(500).optional().describe('Optional note or description for the group'),
  },
  run: ({ userId, args }) =>
    createTransactionGroup({
      userId,
      name: args.name,
      transactionIds: args.transactionIds,
      note: args.note,
    }),
});
