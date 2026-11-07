import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updateLine } from '@services/budget-plans/update-line';
import { updateLineBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), lineId: recordId() }),
  body: updateLineBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updateLine({ userId: user.id, planId: params.planId, lineId: params.lineId, ...body });

  return { data };
});
