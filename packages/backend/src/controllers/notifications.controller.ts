import { NOTIFICATION_PRIORITIES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import {
  notificationStatusSchema,
  notificationTypeSchema,
  notificationTypeValues,
} from '@controllers/notifications/shared-schemas';
import * as notificationsService from '@services/notifications';
import { z } from 'zod';

export const getNotifications = createController(
  z.object({
    query: z.object({
      status: notificationStatusSchema.optional(),
      type: notificationTypeSchema.optional(),
      limit: z.coerce.number().min(1).max(100).optional().default(50),
      offset: z.coerce.number().min(0).optional().default(0),
    }),
  }),
  async ({ user, query }) => {
    const result = await notificationsService.getNotifications({
      userId: user.id,
      status: query.status,
      type: query.type,
      limit: query.limit,
      offset: query.offset,
    });

    return { data: { data: result.data, meta: { total: result.total } } };
  },
);

export const getNotificationById = createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
  }),
  async ({ user, params }) => {
    const notification = await notificationsService.getNotificationById({
      id: params.id,
      userId: user.id,
    });

    return { data: notification };
  },
);

export const getUnreadCount = createController(z.object({}), async ({ user }) => {
  const count = await notificationsService.getUnreadCount({
    userId: user.id,
  });

  return { data: { count } };
});

export const markAsRead = createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
  }),
  async ({ user, params }) => {
    const success = await notificationsService.markAsRead({
      id: params.id,
      userId: user.id,
    });

    return { data: { success } };
  },
);

export const markAllAsRead = createController(z.object({}), async ({ user }) => {
  const updated = await notificationsService.markAllAsRead({
    userId: user.id,
  });

  return { data: { updated } };
});

export const dismissNotification = createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
  }),
  async ({ user, params }) => {
    const success = await notificationsService.dismissNotification({
      id: params.id,
      userId: user.id,
    });

    return { data: { success } };
  },
);

export const createNotification = createController(
  z.object({
    body: z.object({
      type: z.enum(notificationTypeValues),
      title: z.string().max(200),
      message: z.string().optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
      priority: z
        .enum([
          NOTIFICATION_PRIORITIES.low,
          NOTIFICATION_PRIORITIES.normal,
          NOTIFICATION_PRIORITIES.high,
          NOTIFICATION_PRIORITIES.urgent,
        ])
        .optional(),
      expiresAt: z.coerce.date().optional(),
    }),
  }),
  async ({ user, body }) => {
    const notification = await notificationsService.createNotification({
      userId: user.id,
      type: body.type,
      title: body.title,
      message: body.message,
      payload: body.payload,
      priority: body.priority,
      expiresAt: body.expiresAt,
    });

    return { data: notification };
  },
);
