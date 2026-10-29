import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPeriods } from '@services/subscriptions/get-periods';
import { z } from 'zod';

import { getPeriodsQuerySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  query: getPeriodsQuerySchema.optional(),
});

export default createController(schema, async ({ user, params, query }) => {
  const result = await getPeriods({
    userId: user.id,
    subscriptionId: params.id,
    limit: query?.limit,
    offset: query?.offset,
  });

  return { data: result };
});
