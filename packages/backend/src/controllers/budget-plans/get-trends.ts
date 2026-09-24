import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getTrends } from '@services/budget-plans/get-trends';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  query: z.object({
    until: recordId().optional(),
    count: z.coerce.number().int().min(1).max(24).optional().default(6),
  }),
});

export default createController(schema, async ({ user, params, query }) => {
  const data = await getTrends({ userId: user.id, planId: params.planId, until: query.until, count: query.count });

  return { data };
});
