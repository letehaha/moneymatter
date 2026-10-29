import { TRACKER_LIMIT_KINDS } from '@bt/shared/types';
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
  categoryIds: recordArrayIds().optional(),
  tagIds: recordArrayIds().optional(),
  rulesEnabled: z.boolean().optional(),
  rulesCleanup: z.boolean().optional(),
  startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
  endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
  limitAmount: limitAmountSchema(),
  limitKind: z.nativeEnum(TRACKER_LIMIT_KINDS).optional(),
  ...logoFieldsShape,
  logoImage: logoImageSchema,
  ...smartTrackingFieldsShape,
};

export const createTrackerBodySchema = withDateOrder(
  z
    .object(createTrackerBodyShape)
    .superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx })),
  ['startDate', 'endDate'],
);

/** Fields of `PATCH /trackers/:id`; the MCP `update_tracker` tool reads its shape. */
export const editTrackerBodyShape = {
  name: z.string().min(1, 'Name is required').max(200, 'Name must not exceed 200 characters').trim().optional(),
  categoryIds: recordArrayIds().optional(),
  tagIds: recordArrayIds().optional(),
  rulesEnabled: z.boolean().optional(),
  rulesCleanup: z.boolean().optional(),
  startDate: dateBound({ precision: 'datetime' }).nullable().optional(),
  endDate: dateBound({ precision: 'datetime' }).nullable().optional(),
  archivePromptDismissed: z.boolean().optional(),
  limitAmount: limitAmountSchema(),
  limitKind: z.nativeEnum(TRACKER_LIMIT_KINDS).optional(),
  ...logoFieldsShape,
  logoImage: logoImageSchema,
  ...smartTrackingFieldsShape,
};

export const editTrackerBodySchema = withDateOrder(
  z.object(editTrackerBodyShape).superRefine((data, ctx) => refineLogoFields({ data, ctx })),
  ['startDate', 'endDate'],
);
