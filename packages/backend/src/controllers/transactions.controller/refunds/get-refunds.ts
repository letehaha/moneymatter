import { TRANSACTION_TYPES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeRefundTransactions } from '@root/serializers';
import { type GetRefundTransactionsParams, getRefundTransactions } from '@services/tx-refunds/get-refunds.service';
import { z } from 'zod';

const schema = z.object({
  query: z.object({
    categoryId: recordId().optional(),
    accountId: recordId().optional(),
    transactionType: z.enum(TRANSACTION_TYPES).optional(),
    page: z.coerce.number().int().positive(),
    limit: z.coerce.number().int().positive(),
  }),
});

export default createController(schema, async ({ user, query }) => {
  const { id: userId } = user;
  const { categoryId, transactionType, accountId, page, limit } = query;

  const filters: GetRefundTransactionsParams = { userId };

  if (categoryId) filters.categoryId = categoryId;
  if (transactionType) filters.transactionType = transactionType;
  if (accountId) filters.accountId = accountId;
  if (page) filters.page = page;
  if (limit) filters.limit = limit;

  const { rows: refundTransactions, meta } = await getRefundTransactions(filters);

  // Serialize: Money amounts to API decimals
  return {
    data: {
      data: serializeRefundTransactions(refundTransactions),
      meta,
    },
  };
});
