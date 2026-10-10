import { CLIENT_LOG_LEVELS, type RecordClientLogRequest } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { recordClientLog } from '@services/client-logs/record-client-log.service';
import { z } from 'zod';

const MAX_CONTEXT_KEYS = 20;

export const recordClientLogController = createController(
  z.object({
    body: z.object({
      event: z.string().regex(/^[a-z0-9_.:-]{1,100}$/),
      level: z.enum(CLIENT_LOG_LEVELS),
      context: z
        .record(z.string().max(50), z.union([z.string().max(500), z.number(), z.boolean(), z.null()]))
        .refine((value) => Object.keys(value).length <= MAX_CONTEXT_KEYS)
        .optional(),
    }) satisfies z.ZodType<RecordClientLogRequest>,
  }),
  async ({ user, body }) => {
    recordClientLog({ ...body, userId: user.id });
  },
);
