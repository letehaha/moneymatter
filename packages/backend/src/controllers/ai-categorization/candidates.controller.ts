import { type AiCategorizationCandidatesResponse, SORT_DIRECTIONS, TRANSACTION_SORT_FIELD } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransactions } from '@root/serializers';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { listCandidateTransactions } from '@services/ai-categorization';
import { z } from 'zod';

const schema = z.object({
  query: z.object({
    limit: z
      .preprocess((val) => Number(val), z.number().int().min(1).max(100))
      .optional()
      .default(30),
    offset: z
      .preprocess((val) => Number(val), z.number().int().nonnegative())
      .optional()
      .default(0),
    sortBy: z.enum(TRANSACTION_SORT_FIELD).optional(),
    order: z.enum(SORT_DIRECTIONS).optional().default(SORT_DIRECTIONS.desc),
  }),
});

export const categorizationCandidatesController = createController(schema, async ({ user, query }) => {
  const { items, totalCount } = await listCandidateTransactions({
    userId: user.id,
    limit: query.limit,
    offset: query.offset,
    sortBy: query.sortBy,
    order: query.order,
  });

  const data: AiCategorizationCandidatesResponse<TransactionApiResponse> = {
    items: serializeTransactions(items),
    totalCount,
  };

  return { data };
});
