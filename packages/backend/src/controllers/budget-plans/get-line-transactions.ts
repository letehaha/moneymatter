import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { requestTimezone } from '@controllers/helpers/request-timezone';
import { getLineTransactions } from '@services/budget-plans/get-line-transactions';
import { MAX_IDS } from '@services/transactions/get-by-ids';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), periodId: recordId(), lineId: recordId() }),
  query: z.object({
    limit: z.coerce.number().int().min(1).max(MAX_IDS).optional().default(5),
  }),
});

export default createController(schema, async ({ user, params, query, req }) => {
  const data = await getLineTransactions({
    userId: user.id,
    ...params,
    limit: query.limit,
    timezone: await requestTimezone({ req }),
  });

  return { data };
});
