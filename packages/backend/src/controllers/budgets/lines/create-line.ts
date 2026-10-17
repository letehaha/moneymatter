import { decimalMoney, recordArrayIds, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTrackerLine } from '@root/serializers';
import { createTrackerLine } from '@services/budgets/lines/create-line';
import { z } from 'zod';

export const lineBodyFields = {
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters'),
  limitAmount: decimalMoney()
    .refine((m) => m.isPositive(), { message: 'Limit amount must be positive' })
    .nullable()
    .optional(),
  categoryIds: recordArrayIds().min(1, 'At least one category is required'),
  position: z.number().int().min(0).optional(),
};

const schema = z.object({
  params: z.object({ id: recordId() }),
  body: z.object(lineBodyFields),
});

export default createController(schema, async ({ user, params, body }) => {
  const line = await createTrackerLine({ userId: user.id, budgetId: params.id, ...body });

  return { data: serializeTrackerLine(line) };
});
