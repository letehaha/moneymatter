import { PLANS, SYSTEM_NOTIFICATION_ICONS } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { broadcastSystemNotification } from '@services/admin/broadcast-notification.service';
import { updateUserPlan } from '@services/admin/user-plan.service';
import { z } from 'zod';

export const adminUpdateUserPlan = createController(
  z.object({
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: z
      .object({
        plan: z.enum([PLANS.essential, PLANS.plus, PLANS.early_adopter]).nullable().optional(),
        trialEndsAt: z.coerce.date().nullable().optional(),
      })
      .strict(),
  }),
  async ({ params, body, user }) => ({
    data: await updateUserPlan({ userId: params.id, actorId: user.id, ...body }),
  }),
);

export const adminBroadcastNotification = createController(
  z.object({
    body: z
      .object({
        title: z.string().trim().min(1).max(200),
        message: z.string().trim().max(1000).optional(),
        url: z
          .url({ protocol: /^https$/ })
          .max(2048)
          .optional(),
        icon: z.enum(Object.values(SYSTEM_NOTIFICATION_ICONS)).optional(),
        userIds: z.array(z.number().int().positive().max(2_147_483_647)).min(1).max(10_000).optional(),
        emails: z.array(z.email()).min(1).max(10_000).optional(),
      })
      .strict(),
  }),
  async ({ body, user }) => ({
    data: await broadcastSystemNotification({ actorId: user.id, ...body }),
  }),
);
