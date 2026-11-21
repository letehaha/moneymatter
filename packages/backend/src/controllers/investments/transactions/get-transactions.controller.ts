import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { dateRange, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getTransactions } from '@services/investments/transactions/get.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({}).optional(),
  query: withDateOrder(
    z.object({
      ...dateRange({ precision: 'datetime' }),
      portfolioId: recordId().optional(),
      securityId: recordId().optional(),
      category: z.enum(INVESTMENT_TRANSACTION_CATEGORY).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional().default(20),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
  ),
});

export default createController(schema, async ({ user, query }) => {
  const result = await getTransactions({ userId: user.id, ...query });

  return { data: result };
});
