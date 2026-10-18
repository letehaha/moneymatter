import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransactions } from '@root/serializers';
import { recommendationQuerySchema } from '@services/transactions/transactions-linking/recommendation-schemas';
import { getRefundRecommendations } from '@services/tx-refunds/get-refund-recommendations.service';
import { z } from 'zod';

const schema = z.object({
  query: recommendationQuerySchema,
});

export default createController(schema, async ({ user, query }) => {
  const transactions = await getRefundRecommendations({ userId: user.id, ...query });

  return { data: serializeTransactions(transactions) };
});
