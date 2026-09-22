import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deletePlan } from '@services/budget-plans/delete-plan';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  await deletePlan({ userId: user.id, planId: params.planId });
});
