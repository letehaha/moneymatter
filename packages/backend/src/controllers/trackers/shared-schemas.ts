import { TRACKER_TYPES } from '@bt/shared/types';
import { dateBound, decimalMoney, recordArrayIds, withDateOrder } from '@common/lib/zod/custom-types';
import {
  logoFieldsShape,
  logoImageSchema,
  refineLogoFields,
  refineLogoFieldsOnCreate,
} from '@controllers/common/logo-fields.schema';
import { z } from 'zod';

import { smartTrackingFieldsShape } from './smart-tracking-fields.schema';

const limitAmountSchema = () =>
  decimalMoney()
    .refine((m) => m.isPositive(), { message: 'Limit amount must be positive' })
    .nullable()
    .optional();

/** Fields of `POST /trackers`; the MCP `create_tracker` tool reads its shape. */
export const createTrackerBodyShape = {
  name: z.string().min(1, 'Name is required').max(200, 'The name must not exceed 200 characters').trim(),
  type: z.nativeEnum(TRACKER_TYPES).optional().default(TRACKER_TYPES.manual),
  categoryIds: recordArrayIds().optional(),
  startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
  endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
  autoInclude: z.boolean().optional().default(false),
  limitAmount: limitAmountSchema(),
  ...logoFieldsShape,
  logoImage: logoImageSchema,
  ...smartTrackingFieldsShape,
};

export const createTrackerBodySchema = withDateOrder(
  z
    .object(createTrackerBodyShape)
    .superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx }))
    .refine((data) => data.type !== TRACKER_TYPES.category || (data.categoryIds && data.categoryIds.length > 0), {
      message: 'Category trackers require at least one category',
      path: ['categoryIds'],
    }),
  ['startDate', 'endDate'],
);

/** Fields of `PATCH /trackers/:id`; the MCP `update_tracker` tool reads its shape. */
export const editTrackerBodyShape = {
  name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters').trim().optional(),
  categoryIds: recordArrayIds().min(1).optional(),
  startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
  endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
  autoInclude: z.boolean().optional(),
  archivePromptDismissed: z.boolean().optional(),
  limitAmount: limitAmountSchema(),
  ...logoFieldsShape,
  logoImage: logoImageSchema,
  ...smartTrackingFieldsShape,
};

export const editTrackerBodySchema = withDateOrder(
  z.object(editTrackerBodyShape).superRefine((data, ctx) => refineLogoFields({ data, ctx })),
  ['startDate', 'endDate'],
);
