import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { recommendationQuerySchema } from '@services/transactions/transactions-linking/recommendation-schemas';
import { getRefundRecommendations } from '@services/tx-refunds/get-refund-recommendations.service';

import { defineTool } from '../define-tool';
import { recommendationInput } from './recommendation-input';
import { presentTransactions } from './transaction-output';

export const getRefundRecommendationsTool = defineTool({
  name: 'get_refund_recommendations',
  toolset: 'review',
  access: 'read',
  description:
    'Suggest transactions that a refund could be linked to: up to 5 of the opposite type (income for an expense, expense for an income) from the last 6 months, within 50 of the amount in the base currency, leaving out transfers, planned rows and rows that already act as refunds. Give transactionId, or transactionType + originAmount + accountId for a transaction that is not saved yet. Returns { transactions }; an unknown id gives an empty list. Link a pair with link_refund.',
  input: recommendationInput,
  run: async ({ userId, args }) => {
    const query = recommendationQuerySchema.parse(args);
    const transactions = await getRefundRecommendations({ userId, ...query });

    return {
      transactions: await presentTransactions({ userId, transactions: serializeTransactions(transactions) }),
    };
  },
});
