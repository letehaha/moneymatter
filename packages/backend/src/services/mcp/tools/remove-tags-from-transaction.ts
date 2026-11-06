import { recordId } from '@common/lib/zod/custom-types';
import { removeTransactionsFromTag } from '@services/tags/transaction-tags';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const removeTagsFromTransactionTool = defineTool({
  name: 'remove_tags_from_transaction',
  toolset: 'core',
  access: 'write',
  description:
    'Remove a tag from one or more transactions. Use when the user wants to untag transactions. Returns the count of removed tag links.',
  input: {
    tagId: recordId().describe('ID of the tag to remove from transactions.'),
    transactionIds: z.array(recordId()).describe('List of transaction IDs to remove the tag from.'),
  },
  run: ({ userId, args }) =>
    removeTransactionsFromTag({
      tagId: args.tagId,
      userId,
      transactionIds: args.transactionIds,
    }),
});
