import { dateBound, decimalMoney, recordId, recordArrayIds, withDateOrder } from '@common/lib/zod/custom-types';
import { logoFieldsShape, logoImageSchema, refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTracker } from '@root/serializers';
import * as editTrackerService from '@services/trackers/edit-tracker';
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
        categoryIds: recordArrayIds().optional(),
        tagIds: recordArrayIds().optional(),
        rulesEnabled: z.boolean().optional(),
        rulesCleanup: z.boolean().optional(),
        startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
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
    tagIds,
    rulesEnabled,
    rulesCleanup,
    startDate,
    endDate,
    limitAmount,
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

  const tracker = await editTrackerService.editTracker({
    id: params.id,
    userId: user.id,
    name,
    categoryIds,
    tagIds,
    rulesEnabled,
    rulesCleanup,
    startDate,
    endDate,
    limitAmount,
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
  return { data: tracker ? serializeTracker(tracker) : null };
});
