import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { setLayout } from '@services/budget-plans/line-groups';
import { setLayoutBodySchema } from '@services/budget-plans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: setLayoutBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  await setLayout({ userId: user.id, planId: params.planId, ...body });
});
