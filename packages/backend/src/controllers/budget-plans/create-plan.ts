import { createController } from '@controllers/helpers/controller-factory';
import { createPlan } from '@services/budget-plans/create-plan';
import { createPlanBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  body: createPlanBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const data = await createPlan({ userId: user.id, ...body });

  return { data, statusCode: 201 };
});
