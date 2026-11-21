import { SORT_DIRECTIONS, TRANSACTION_SORT_FIELD } from '@bt/shared/types';
import { booleanQuery, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransactions } from '@root/serializers';
import { attachTransactionCurrencyMeta } from '@services/currencies/effective-currency';
import * as transactionsService from '@services/transactions';
import { z } from 'zod';

import {
  amountRangeIssue,
  isAmountRangeOrdered,
  isRefundPivotPaired,
  refundPivotPairIssue,
  toServiceFilters,
  transactionFilterFields,
} from './transaction-filters';

const schema = z.object({
  query: withDateOrder(
    z
      .object({
        order: z.enum(SORT_DIRECTIONS).optional().default(SORT_DIRECTIONS.desc),
        sortBy: z.enum(TRANSACTION_SORT_FIELD).optional(),
        limit: z.preprocess((val) => Number(val), z.number().int().positive().max(1000)).optional(),
        // Pagination row offset. Named `offset` to match the shared pagination vocabulary;
        // the model still calls this `from` internally (mapped in the handler below).
        offset: z
          .preprocess((val) => Number(val), z.number().int().nonnegative())
          .optional()
          .default(0),
        includeRefundedAmount: booleanQuery().optional(),
        ...transactionFilterFields,
      })
      .refine(isAmountRangeOrdered, amountRangeIssue)
      .refine(isRefundPivotPaired, refundPivotPairIssue),
  ),
});

export default createController(schema, async ({ user, query }) => {
  const { offset, ...filters } = query;

  const transactions = await transactionsService.getTransactions({
    ...toServiceFilters(filters),
    from: offset,
    userId: user.id,
  });

  await attachTransactionCurrencyMeta({ transactions });

  // Serialize: Money amounts to API decimals
  return { data: serializeTransactions(transactions) };
});
