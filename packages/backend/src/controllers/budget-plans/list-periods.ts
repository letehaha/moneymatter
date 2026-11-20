import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { requestTimezone } from '@controllers/helpers/request-timezone';
import { listPeriods } from '@services/budget-plans/list-periods';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
});

export default createController(schema, async ({ user, params, req }) => {
  const data = await listPeriods({ userId: user.id, planId: params.planId, timezone: await requestTimezone({ req }) });

  return { data };
});
