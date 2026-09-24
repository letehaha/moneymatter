import { budgetPlanName, dateBound, recordId, uniqueRecordIds } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createLine } from '@services/budget-plans/create-line';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: z.strictObject({
    name: budgetPlanName(),
    categoryIds: uniqueRecordIds({ min: 1 }),
    sortOrder: z.int32().optional(),
    groupId: recordId().nullable().optional(),
    activeFrom: dateBound().optional(),
  }),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await createLine({ userId: user.id, planId: params.planId, ...body });

  return { data, statusCode: 201 };
});
