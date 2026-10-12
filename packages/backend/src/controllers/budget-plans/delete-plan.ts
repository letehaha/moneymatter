import { booleanQuery, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deletePlan, purgePlan } from '@services/budget-plans/delete-plan';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  query: z.object({ permanent: booleanQuery().optional() }),
});

export default createController(schema, async ({ user, params, query }) => {
  const remove = query.permanent ? purgePlan : deletePlan;
  await remove({ userId: user.id, planId: params.planId });
});
