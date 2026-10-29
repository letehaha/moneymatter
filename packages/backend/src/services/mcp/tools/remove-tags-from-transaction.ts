import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeTransactionsFromTag } from '@services/tags/transaction-tags';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  tagId: recordId().describe('ID of the tag to remove from transactions.'),
  transactionIds: z.array(recordId()).describe('List of transaction IDs to remove the tag from.'),
};

export function registerRemoveTagsFromTransaction(server: McpServer) {
  server.registerTool(
    'remove_tags_from_transaction',
    {
      description:
        'Remove a tag from one or more transactions. Use when the user wants to untag transactions. Returns the count of removed tag links.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'remove_tags_from_transaction', clientId: extra.authInfo?.clientId });

      const result = await removeTransactionsFromTag({
        tagId: args.tagId,
        userId,
        transactionIds: args.transactionIds,
      });
      return jsonContent({ data: result });
    },
  );
}
