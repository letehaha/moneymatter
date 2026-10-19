import { TRACKER_AI_DESCRIPTION_MAX_LENGTH, TRACKER_AI_PRE_WINDOW_DAYS } from '@bt/shared/types';
import { z } from 'zod';

export const smartTrackingFieldsShape = {
  aiEnabled: z.boolean().optional(),
  aiDescription: z
    .string()
    .trim()
    .max(
      TRACKER_AI_DESCRIPTION_MAX_LENGTH,
      `The description must not exceed ${TRACKER_AI_DESCRIPTION_MAX_LENGTH} characters`,
    )
    .transform((value) => value || null)
    .nullable()
    .optional(),
  aiPreWindowDays: z.literal(TRACKER_AI_PRE_WINDOW_DAYS).optional(),
};
