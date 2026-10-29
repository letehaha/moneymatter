import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransactions } from '@root/serializers';
import { getTransferRecommendations } from '@services/transactions/transactions-linking/get-transfer-recommendations.service';
import { recommendationQuerySchema } from '@services/transactions/transactions-linking/recommendation-schemas';
import { z } from 'zod';

const schema = z.object({
  query: recommendationQuerySchema,
});

export default createController(schema, async ({ user, query }) => {
  const transactions = await getTransferRecommendations({ userId: user.id, ...query });

  return { data: serializeTransactions(transactions) };
});
