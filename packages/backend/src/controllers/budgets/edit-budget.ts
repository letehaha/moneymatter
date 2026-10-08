import { dateBound, decimalMoney, recordId, recordArrayIds, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeBudget } from '@root/serializers';
import * as editBudgetService from '@services/budgets/edit-budget';
import { z } from 'zod';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: withDateOrder(
    z.object({
      name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters').trim().optional(),
      categoryIds: recordArrayIds().optional(),
      tagIds: recordArrayIds().optional(),
      startDate: dateBound({ precision: 'datetime' }).optional(),
      endDate: dateBound({ precision: 'datetime' }).optional(),
      autoInclude: z.boolean().optional().default(false),
      limitAmount: decimalMoney()
        .refine((m) => m.isPositive(), { message: 'Limit amount must be positive' })
        .optional(),
    }),
    ['startDate', 'endDate'],
  ),
});

export default createController(schema, async ({ user, params, body }) => {
  const { name, categoryIds, tagIds, startDate, endDate, limitAmount, autoInclude } = body;

  const budget = await editBudgetService.editBudget({
    id: params.id,
    userId: user.id,
    name,
    categoryIds,
    tagIds,
    startDate,
    endDate,
    limitAmount,
    autoInclude,
  });

  // Serialize: convert cents to decimal for API response
  return { data: budget ? serializeBudget(budget) : null };
});
