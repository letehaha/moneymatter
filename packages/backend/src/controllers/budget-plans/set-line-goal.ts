import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { lineGoalSchema } from '@services/budget-plans/line-goal-schema';
import { setLineGoal } from '@services/budget-plans/line-goals';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), lineId: recordId() }),
  body: lineGoalSchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await setLineGoal({ userId: user.id, ...params, ...body });

  return { data };
});
