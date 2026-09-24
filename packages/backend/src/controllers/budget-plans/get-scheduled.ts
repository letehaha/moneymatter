import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getScheduled } from '@services/budget-plans/get-scheduled';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), periodId: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  const data = await getScheduled({ userId: user.id, planId: params.planId, periodId: params.periodId });

  return { data };
});
