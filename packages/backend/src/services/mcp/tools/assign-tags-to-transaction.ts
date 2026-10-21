import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addTransactionsToTag } from '@services/tags/transaction-tags';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  tagId: recordId().describe('ID of the tag to assign.'),
  transactionIds: z.array(recordId()).describe('List of transaction IDs to tag.'),
};

export function registerAssignTagsToTransaction(server: McpServer) {
  server.registerTool(
    'assign_tags_to_transaction',
    {
      description:
        'Assign one or more tags to a transaction. Use when the user wants to label a transaction with existing tags. Already-assigned tags are silently skipped. Returns counts of added and skipped tags.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'assign_tags_to_transaction', clientId: extra.authInfo?.clientId });

      const result = await addTransactionsToTag({ tagId: args.tagId, userId, transactionIds: args.transactionIds });
      return jsonContent({ data: result });
    },
  );
}
