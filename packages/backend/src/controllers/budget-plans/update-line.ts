import { budgetPlanName, dateBound, recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updateLine } from '@services/budget-plans/update-line';
import { z } from 'zod';

// An empty `categoryIds` is not how a line is emptied: archiving is.
const schema = z.object({
  params: z.object({ planId: recordId(), lineId: recordId() }),
  body: z
    .strictObject({
      name: budgetPlanName().optional(),
      sortOrder: z.int32().optional(),
      groupId: recordId().nullable().optional(),
      categoryIds: uniqueRecordIds({ min: 1 }).optional(),
      effectiveFrom: dateBound().optional(),
    })
    .refine((body) => body.effectiveFrom === undefined || body.categoryIds !== undefined, {
      message: 'effectiveFrom can only be used together with categoryIds',
      path: ['effectiveFrom'],
    }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updateLine({ userId: user.id, planId: params.planId, lineId: params.lineId, ...body });

  return { data };
});
