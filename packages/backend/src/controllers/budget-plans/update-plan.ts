import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updatePlan } from '@services/budget-plans/update-plan';
import { updatePlanBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: updatePlanBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updatePlan({ userId: user.id, planId: params.planId, ...body });

  return { data };
});
