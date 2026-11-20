import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { restorePlan } from '@services/budget-plans/restore-plan';
import { restorePlanBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: restorePlanBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await restorePlan({ userId: user.id, planId: params.planId, replace: body?.replace });

  return { data };
});
