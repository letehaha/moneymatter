import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updateGroup } from '@services/budget-plans/line-groups';
import { updateGroupBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), groupId: recordId() }),
  body: updateGroupBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updateGroup({ userId: user.id, ...params, name: body.name });

  return { data };
});
