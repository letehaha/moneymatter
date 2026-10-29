import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { recommendationQuerySchema } from '@services/transactions/transactions-linking/recommendation-schemas';
import { getRefundRecommendations } from '@services/tx-refunds/get-refund-recommendations.service';

import { getUserId, jsonContent } from './helpers';
import { recommendationInput } from './recommendation-input';
import { presentTransactions } from './transaction-output';

export function registerGetRefundRecommendations(server: McpServer) {
  server.registerTool(
    'get_refund_recommendations',
    {
      description:
        'Suggest transactions that a refund could be linked to: up to 5 of the opposite type (income for an expense, expense for an income) from the last 6 months, within 50 of the amount in the base currency, leaving out transfers, planned rows and rows that already act as refunds. Give transactionId, or transactionType + originAmount + accountId for a transaction that is not saved yet. Returns { transactions }; an unknown id gives an empty list. Link a pair with link_refund.',
      inputSchema: recommendationInput,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_refund_recommendations', clientId: extra.authInfo?.clientId });

      const query = recommendationQuerySchema.parse(args);
      const transactions = await getRefundRecommendations({ userId, ...query });

      return jsonContent({
        data: {
          transactions: await presentTransactions({ userId, transactions: serializeTransactions(transactions) }),
        },
      });
    },
  );
}
