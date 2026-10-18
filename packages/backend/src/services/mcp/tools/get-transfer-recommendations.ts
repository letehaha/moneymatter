import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { getTransferRecommendations } from '@services/transactions/transactions-linking/get-transfer-recommendations.service';
import { recommendationQuerySchema } from '@services/transactions/transactions-linking/recommendation-schemas';

import { getUserId, jsonContent } from './helpers';
import { recommendationInput } from './recommendation-input';
import { presentTransactions } from './transaction-output';

export function registerGetTransferRecommendations(server: McpServer) {
  server.registerTool(
    'get_transfer_recommendations',
    {
      description:
        'Suggest the other leg of a transfer: up to 7 transactions of the opposite type (income for an expense, expense for an income) on other accounts, within 10% of the amount in the base currency and 14 days of the date, leaving out transfers, refunds, planned rows and split parents; same currency and closer amount and date rank first. Give transactionId, or transactionType + originAmount + accountId for a transaction that is not saved yet. Returns { transactions }; an unknown id gives an empty list. Link a pair with link_transfer; to scan a whole period at once use list_transfer_suggestions.',
      inputSchema: recommendationInput,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_transfer_recommendations', clientId: extra.authInfo?.clientId });

      const query = recommendationQuerySchema.parse(args);
      const transactions = await getTransferRecommendations({ userId, ...query });

      return jsonContent({
        data: {
          transactions: await presentTransactions({ userId, transactions: serializeTransactions(transactions) }),
        },
      });
    },
  );
}
