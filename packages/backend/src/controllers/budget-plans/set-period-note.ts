import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { requestTimezone } from '@controllers/helpers/request-timezone';
import { setPeriodNote } from '@services/budget-plans/set-period-note';
import { setNoteBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), periodId: recordId() }),
  body: setNoteBodySchema,
});

export default createController(schema, async ({ user, params, body, req }) => {
  const data = await setPeriodNote({ userId: user.id, ...params, ...body, timezone: await requestTimezone({ req }) });

  return { data };
});
