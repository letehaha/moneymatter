import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { suggestHistoricalMatches } from '@services/subscriptions/suggest-historical-matches';

import { getUserId, jsonContent } from './helpers';
import { presentTransactions } from './transaction-output';

const inputSchema = {
  subscriptionId: recordId().describe('ID of the subscription whose matching rules to run'),
};

export function registerListSubscriptionMatchSuggestions(server: McpServer) {
  server.registerTool(
    'list_subscription_match_suggestions',
    {
      description:
        'List past transactions (the last 12 months, at most 100, newest first) that a subscription’s matching rules would match but that are not linked to it yet. Returns an empty list when the subscription has no usable rules. Link the right ones with link_transactions_to_subscription. Reads only.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_subscription_match_suggestions', clientId: extra.authInfo?.clientId });

      const transactions = await suggestHistoricalMatches({ subscriptionId: args.subscriptionId, userId });
      const suggestions = await presentTransactions({ userId, transactions });

      return jsonContent({ data: { suggestions, total: suggestions.length } });
    },
  );
}
