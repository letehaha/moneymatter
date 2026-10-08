import { SORT_DIRECTIONS, TRANSACTION_SORT_FIELD } from '@bt/shared/types';
import { booleanQuery, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransactions } from '@root/serializers';
import * as transactionsService from '@services/transactions';
import { z } from 'zod';

import {
  amountRangeIssue,
  isAmountRangeOrdered,
  toServiceFilters,
  transactionFilterFields,
} from './transaction-filters';

const schema = z.object({
  query: withDateOrder(
    z
      .object({
        order: z.nativeEnum(SORT_DIRECTIONS).optional().default(SORT_DIRECTIONS.desc),
        sortBy: z.nativeEnum(TRANSACTION_SORT_FIELD).optional(),
        limit: z.preprocess((val) => Number(val), z.number().int().positive()).optional(),
        // Pagination row offset. Named `offset` to match the shared pagination vocabulary;
        // the model still calls this `from` internally (mapped in the handler below).
        offset: z
          .preprocess((val) => Number(val), z.number().int().nonnegative())
          .optional()
          .default(0),
        includeSplits: booleanQuery().optional(),
        includeTags: booleanQuery().optional(),
        includeGroups: booleanQuery().optional(),
        includeHasAttachments: booleanQuery().optional(),
        ...transactionFilterFields,
      })
      .refine(isAmountRangeOrdered, amountRangeIssue),
  ),
});

export default createController(schema, async ({ user, query }) => {
  const { offset, ...filters } = query;

  const transactions = await transactionsService.getTransactions({
    ...toServiceFilters(filters),
    from: offset,
    userId: user.id,
  });

  // Serialize: convert cents to decimal for API response
  return { data: serializeTransactions(transactions) };
});
