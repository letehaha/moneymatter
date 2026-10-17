import { SUBSCRIPTION_MATCH_SOURCE } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { linkTransactionsToSubscription } from '@services/subscriptions';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  subscriptionId: recordId().describe('UUID of the subscription'),
  transactionIds: z.array(recordId()).describe('IDs of transactions to link to the subscription'),
  matchSource: z
    .enum([SUBSCRIPTION_MATCH_SOURCE.manual, SUBSCRIPTION_MATCH_SOURCE.rule, SUBSCRIPTION_MATCH_SOURCE.ai])
    .describe('How the match was determined: manual, rule, or ai'),
};

export function registerLinkTransactionsToSubscription(server: McpServer) {
  server.registerTool(
    'link_transactions_to_subscription',
    {
      description:
        'Link one or more transactions to a subscription to mark them as payment instances. Use matchSource="manual" for user-initiated linking. If the subscription has a categoryId and matchSource="rule", the category is applied to the transactions automatically. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'link_transactions_to_subscription', clientId: extra.authInfo?.clientId });

      const result = await linkTransactionsToSubscription({
        subscriptionId: args.subscriptionId,
        transactionIds: args.transactionIds,
        userId,
        matchSource: args.matchSource,
      });

      return jsonContent({ data: result });
    },
  );
}
