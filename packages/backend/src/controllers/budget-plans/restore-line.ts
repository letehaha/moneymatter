import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { restoreLine } from '@services/budget-plans/restore-line';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId(), lineId: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  const data = await restoreLine({ userId: user.id, planId: params.planId, lineId: params.lineId });

  return { data };
});
