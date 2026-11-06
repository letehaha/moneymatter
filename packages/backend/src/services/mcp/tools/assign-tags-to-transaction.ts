import { recordId } from '@common/lib/zod/custom-types';
import { addTransactionsToTag } from '@services/tags/transaction-tags';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const assignTagsToTransactionTool = defineTool({
  name: 'assign_tags_to_transaction',
  toolset: 'core',
  access: 'write',
  description:
    'Assign one or more tags to a transaction. Use when the user wants to label a transaction with existing tags. Already-assigned tags are silently skipped. Returns counts of added and skipped tags.',
  input: {
    tagId: recordId().describe('ID of the tag to assign.'),
    transactionIds: z.array(recordId()).describe('List of transaction IDs to tag.'),
  },
  run: ({ userId, args }) => addTransactionsToTag({ tagId: args.tagId, userId, transactionIds: args.transactionIds }),
});
