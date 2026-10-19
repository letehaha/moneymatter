import { dateBound, decimalMoney, recordId, recordArrayIds, withDateOrder } from '@common/lib/zod/custom-types';
import { logoFieldsShape, logoImageSchema, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeBudget } from '@root/serializers';
import * as editBudgetService from '@services/budgets/edit-budget';
import { z } from 'zod';

import { smartTrackingFieldsShape } from './smart-tracking-fields.schema';

const schema = z.object({
  params: z.object({
    id: recordId(),
  }),
  body: withDateOrder(
    z
      .object({
        name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters').trim().optional(),
        categoryIds: recordArrayIds().min(1).optional(),
        startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        autoInclude: z.boolean().optional(),
        archivePromptDismissed: z.boolean().optional(),
        limitAmount: decimalMoney()
          .refine((m) => m.isPositive(), { message: 'Limit amount must be positive' })
          .nullable()
          .optional(),
        ...logoFieldsShape,
        logoImage: logoImageSchema,
        ...smartTrackingFieldsShape,
      })
      .superRefine((data, ctx) => refineLogoFields({ data, ctx })),
    ['startDate', 'endDate'],
  ),
});

export default createController(schema, async ({ user, params, body }) => {
  const {
    name,
    categoryIds,
    startDate,
    endDate,
    limitAmount,
    autoInclude,
    archivePromptDismissed,
    logoDomain,
    logoInitials,
    logoColor,
    logoIcon,
    logoImage,
    aiEnabled,
    aiDescription,
    aiPreWindowDays,
  } = body;

  const budget = await editBudgetService.editBudget({
    id: params.id,
    userId: user.id,
    name,
    categoryIds,
    startDate,
    endDate,
    limitAmount,
    autoInclude,
    archivePromptDismissed,
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
  return { data: budget ? serializeBudget(budget) : null };
});
