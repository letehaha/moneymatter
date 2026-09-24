import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteGroup } from '@services/budget-plans/line-groups';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), groupId: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  await deleteGroup({ userId: user.id, ...params });
});
