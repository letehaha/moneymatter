import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { requestTimezone } from '@controllers/helpers/request-timezone';
import { setAssignment } from '@services/budget-plans/set-assignment';
import { setAssignmentBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), periodId: recordId(), lineId: recordId() }),
  body: setAssignmentBodySchema,
});

export default createController(schema, async ({ user, params, body, req }) => {
  const data = await setAssignment({ userId: user.id, ...params, ...body, timezone: await requestTimezone({ req }) });

  return { data };
});
