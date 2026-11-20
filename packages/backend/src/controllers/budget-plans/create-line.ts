import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createLine } from '@services/budget-plans/create-line';
import { createLineBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: createLineBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await createLine({ userId: user.id, planId: params.planId, ...body });

  return { data, statusCode: 201 };
});
