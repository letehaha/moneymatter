import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { dismissCandidate } from '@services/subscriptions';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  candidateId: z.string().describe('UUID of the subscription candidate to dismiss'),
};

export function registerDismissSubscriptionCandidate(server: McpServer) {
  server.registerTool(
    'dismiss_subscription_candidate',
    {
      description:
        'Dismiss a pending subscription candidate so it no longer appears in the candidate list. The underlying transactions are unaffected. Only pending candidates can be dismissed. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'dismiss_subscription_candidate', clientId: extra.authInfo?.clientId });

      const result = await dismissCandidate({ userId, candidateId: args.candidateId });

      return jsonContent({ data: result });
    },
  );
}
