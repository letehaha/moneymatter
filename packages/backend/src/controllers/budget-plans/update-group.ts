import { budgetPlanName, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updateGroup } from '@services/budget-plans/line-groups';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), groupId: recordId() }),
  body: z.strictObject({ name: budgetPlanName() }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updateGroup({ userId: user.id, ...params, name: body.name });

  return { data };
});
