import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteLineGoal } from '@services/budget-plans/line-goals';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), lineId: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  await deleteLineGoal({ userId: user.id, ...params });
});
