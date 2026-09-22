import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPlan } from '@services/budget-plans/get-plan';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  const data = await getPlan({ userId: user.id, planId: params.planId });

  return { data };
});
