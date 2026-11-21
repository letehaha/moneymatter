import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createGroup } from '@services/budget-plans/line-groups';
import { createGroupBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: createGroupBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await createGroup({ userId: user.id, planId: params.planId, name: body.name });

  return { data, statusCode: 201 };
});
