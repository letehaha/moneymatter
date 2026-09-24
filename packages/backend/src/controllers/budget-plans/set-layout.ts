import { recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { setLayout } from '@services/budget-plans/line-groups';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: z.strictObject({
    groups: z.array(z.strictObject({ id: recordId(), lineIds: uniqueRecordIds() })),
    ungroupedLineIds: uniqueRecordIds(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  await setLayout({ userId: user.id, planId: params.planId, ...body });
});
