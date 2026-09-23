import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteLine } from '@services/budget-plans/delete-line';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), lineId: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  await deleteLine({ userId: user.id, planId: params.planId, lineId: params.lineId });
});
