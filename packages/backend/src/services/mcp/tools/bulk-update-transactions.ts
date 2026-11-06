import { BULK_UPDATE_TAG_MODES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { payeeIdSchema } from '@controllers/transactions.controller/schemas';
import { bulkUpdate } from '@services/transactions/bulk-update';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const bulkUpdateTransactionsTool = defineTool({
  name: 'bulk_update_transactions',
  toolset: 'core',
  access: 'write',
  description:
    'Update multiple transactions at once. Provide transactionIds plus at least one of categoryId, tagIds, note, or payeeId (null clears the payee). Tags can be added to, removed from, or replaced on all specified transactions.',
  input: {
    transactionIds: z.array(recordId()).min(1).describe('IDs of transactions to update'),
    categoryId: recordId().optional().describe('New category ID to assign to all transactions'),
    tagIds: z.array(recordId()).optional().describe('Tag IDs to apply according to tagMode'),
    tagMode: z
      .enum(BULK_UPDATE_TAG_MODES)
      .optional()
      .describe('How to apply tagIds: add (default) appends, replace overwrites, remove removes those tags'),
    note: z.string().max(1000).optional().describe('Note to set on all transactions'),
    payeeId: payeeIdSchema().describe(
      'ID of an existing payee to link to all transactions (from get_payees). Pass null to clear the payee',
    ),
  },
  run: ({ userId, args }) =>
    bulkUpdate({
      userId,
      transactionIds: args.transactionIds,
      categoryId: args.categoryId,
      tagIds: args.tagIds,
      tagMode: args.tagMode,
      note: args.note,
      payeeId: args.payeeId,
    }),
});
