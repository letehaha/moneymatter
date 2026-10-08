import { BULK_UPDATE_TAG_MODES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { bulkUpdate } from '@services/transactions/bulk-update';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transactionIds: z.array(recordId()).min(1).describe('IDs of transactions to update'),
  categoryId: recordId().optional().describe('New category ID to assign to all transactions'),
  tagIds: z.array(recordId()).optional().describe('Tag IDs to apply according to tagMode'),
  tagMode: z
    .enum(BULK_UPDATE_TAG_MODES)
    .optional()
    .describe('How to apply tagIds: add (default) appends, replace overwrites, remove removes those tags'),
  note: z.string().optional().describe('Note to set on all transactions'),
};

export function registerBulkUpdateTransactions(server: McpServer) {
  server.registerTool(
    'bulk_update_transactions',
    {
      description:
        'Update multiple transactions at once. Provide transactionIds plus at least one of categoryId, tagIds, or note. Tags can be added to, removed from, or replaced on all specified transactions.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'bulk_update_transactions', clientId: extra.authInfo?.clientId });

      const result = await bulkUpdate({
        userId,
        transactionIds: args.transactionIds,
        categoryId: args.categoryId,
        tagIds: args.tagIds,
        tagMode: args.tagMode,
        note: args.note,
      });

      return jsonContent({ data: result });
    },
  );
}
