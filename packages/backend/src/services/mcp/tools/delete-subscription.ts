import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteSubscription } from '@services/subscriptions';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  id: z.string().describe('UUID of the subscription to delete'),
};

export function registerDeleteSubscription(server: McpServer) {
  server.registerTool(
    'delete_subscription',
    {
      description:
        'Permanently delete a subscription or recurring bill. Linked transaction associations are also removed. This action cannot be undone. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_subscription', clientId: extra.authInfo?.clientId });

      const result = await deleteSubscription({ id: args.id, userId });

      return jsonContent({ data: result });
    },
  );
}
