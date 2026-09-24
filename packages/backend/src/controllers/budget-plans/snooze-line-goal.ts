import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { snoozeLineGoal } from '@services/budget-plans/line-goals';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), lineId: recordId() }),
  body: z.strictObject({ periodId: recordId() }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await snoozeLineGoal({ userId: user.id, ...params, periodId: body.periodId });

  return { data };
});
