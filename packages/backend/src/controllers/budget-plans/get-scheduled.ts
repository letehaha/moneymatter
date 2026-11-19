import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { requestTimezone } from '@controllers/helpers/request-timezone';
import { getScheduled } from '@services/budget-plans/get-scheduled';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), periodId: recordId() }),
});

export default createController(schema, async ({ user, params, req }) => {
  const data = await getScheduled({
    userId: user.id,
    planId: params.planId,
    periodId: params.periodId,
    timezone: await requestTimezone({ req }),
  });

  return { data };
});
