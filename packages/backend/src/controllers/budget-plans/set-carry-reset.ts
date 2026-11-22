import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { requestTimezone } from '@controllers/helpers/request-timezone';
import { setCarryReset } from '@services/budget-plans/set-carry-reset';
import { setCarryResetBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), periodId: recordId() }),
  body: setCarryResetBodySchema,
});

export default createController(schema, async ({ user, params, body, req }) => {
  const data = await setCarryReset({ userId: user.id, ...params, ...body, timezone: await requestTimezone({ req }) });

  return { data };
});
