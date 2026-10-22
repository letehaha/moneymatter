import { TRACKER_STATUSES } from '@bt/shared/types';
import { dateBound, decimalMoney, recordArrayIds, withDateOrder } from '@common/lib/zod/custom-types';
import { logoFieldsShape, logoImageSchema, refineLogoFieldsOnCreate } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTracker } from '@root/serializers';
import * as trackersService from '@root/services/trackers/create-tracker';
import { z } from 'zod';

import { smartTrackingFieldsShape } from './smart-tracking-fields.schema';

const schema = z.object({
  body: withDateOrder(
    z
      .object({
        name: z.string().min(1, 'Name is required').max(200, 'The name must not exceed 200 characters').trim(),
        categoryIds: recordArrayIds().optional(),
        tagIds: recordArrayIds().optional(),
        rulesEnabled: z.boolean().optional(),
        rulesCleanup: z.boolean().optional(),
        startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
        limitAmount: decimalMoney()
          .refine((m) => m.isPositive(), { message: 'Limit amount must be positive' })
          .nullable()
          .optional(),
        ...logoFieldsShape,
        logoImage: logoImageSchema,
        ...smartTrackingFieldsShape,
      })
      .superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx })),
    ['startDate', 'endDate'],
  ),
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;
  const {
    name,
    categoryIds,
    tagIds,
    rulesEnabled,
    rulesCleanup,
    startDate,
    endDate,
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

  const tracker = await trackersService.createTracker({
    name,
    userId,
    status: TRACKER_STATUSES.active,
    categoryIds,
    tagIds,
    rulesEnabled,
    rulesCleanup,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
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
  return { data: serializeTracker(tracker) };
});
