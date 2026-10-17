import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toggleSubscriptionActive } from '@services/subscriptions';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  id: z.string().describe('UUID of the subscription'),
  isActive: z.boolean().describe('True to activate the subscription, false to deactivate it'),
};

export function registerToggleSubscriptionActive(server: McpServer) {
  server.registerTool(
    'toggle_subscription_active',
    {
      description:
        'Activate or deactivate a subscription. Inactive subscriptions are excluded from upcoming payment calculations and summary totals. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'toggle_subscription_active', clientId: extra.authInfo?.clientId });

      const result = await toggleSubscriptionActive({ id: args.id, userId, isActive: args.isActive });

      return jsonContent({ data: result });
    },
  );
}
