import { BUDGET_STATUSES, BUDGET_TYPES } from '@bt/shared/types';
import { dateBound, decimalMoney, recordArrayIds, withDateOrder } from '@common/lib/zod/custom-types';
import { logoFieldsShape, logoImageSchema, refineLogoFieldsOnCreate } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeBudget } from '@root/serializers';
import * as budgetsService from '@root/services/budgets/create-budget';
import { z } from 'zod';

import { smartTrackingFieldsShape } from './smart-tracking-fields.schema';

const schema = z.object({
  body: withDateOrder(
    z
      .object({
        name: z.string().min(1, 'Name is required').max(200, 'The name must not exceed 200 characters').trim(),
        type: z.nativeEnum(BUDGET_TYPES).optional().default(BUDGET_TYPES.manual),
        categoryIds: recordArrayIds().optional(),
        startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        autoInclude: z.boolean().optional().default(false),
        limitAmount: decimalMoney()
          .refine((m) => m.isPositive(), { message: 'Limit amount must be positive' })
          .nullable()
          .optional(),
        ...logoFieldsShape,
        logoImage: logoImageSchema,
        ...smartTrackingFieldsShape,
      })
      .superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx }))
      .refine((data) => data.type !== BUDGET_TYPES.category || (data.categoryIds && data.categoryIds.length > 0), {
        message: 'Category budgets require at least one category',
        path: ['categoryIds'],
      }),
    ['startDate', 'endDate'],
  ),
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;
  const {
    name,
    type,
    categoryIds,
    startDate,
    endDate,
    autoInclude,
    limitAmount,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
    aiEnabled,
    aiDescription,
    aiPreWindowDays,
  } = body;

  const budget = await budgetsService.createBudget({
    name,
    userId,
    status: BUDGET_STATUSES.active,
    type,
    categoryIds,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    autoInclude,
    limitAmount,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
    aiEnabled,
    aiDescription,
    aiPreWindowDays,
  });

  // Serialize: convert cents to decimal for API response
  return { data: serializeBudget(budget) };
});
