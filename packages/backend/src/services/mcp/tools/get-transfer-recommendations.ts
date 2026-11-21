import { serializeTransactions } from '@root/serializers/transactions.serializer';
import { getTransferRecommendations } from '@services/transactions/transactions-linking/get-transfer-recommendations.service';
import { recommendationQuerySchema } from '@services/transactions/transactions-linking/recommendation-schemas';

import { defineTool } from '../define-tool';
import { recommendationInput } from './recommendation-input';
import { presentTransactions } from './transaction-output';

export const getTransferRecommendationsTool = defineTool({
  name: 'get_transfer_recommendations',
  toolset: 'review',
  access: 'read',
  description:
    'Suggest the other leg of a transfer: up to 7 transactions of the opposite type (income for an expense, expense for an income) on other accounts, within 10% of the amount in the base currency and 14 days of the date, leaving out transfers, refunds, planned rows and split parents; same currency and closer amount and date rank first. Give transactionId, or transactionType + originAmount + accountId for a transaction that is not saved yet. Returns { transactions }; an unknown id gives an empty list. Link a pair with link_transfer; to scan a whole period at once use list_transfer_suggestions.',
  input: recommendationInput,
  run: async ({ userId, args }) => {
    const query = recommendationQuerySchema.parse(args);
    const transactions = await getTransferRecommendations({ userId, ...query });

    return {
      transactions: await presentTransactions({ userId, transactions: serializeTransactions(transactions) }),
    };
  },
});
