import { booleanQuery } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { listPlans } from '@services/budget-plans/get-plan';
import { z } from 'zod';

const schema = z.object({
  query: z.object({
    includeDeleted: booleanQuery().optional(),
  }),
});

export default createController(schema, async ({ user, query }) => {
  const data = await listPlans({ userId: user.id, includeDeleted: query.includeDeleted });

  return { data };
});
