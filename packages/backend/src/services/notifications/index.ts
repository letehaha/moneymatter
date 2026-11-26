import {
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_STATUSES,
  NotificationModel,
  NotificationPayload,
  NotificationPriority,
  NotificationStatus,
  NotificationType,
} from '@bt/shared/types';
import Notifications from '@models/notifications.model';
import { runAfterCommit } from '@services/common/run-after-commit';

import { withTransaction } from '../common/with-transaction';
import { isApnsConfigured, sendNotificationPush } from './apns';

interface CreateNotificationParams {
  userId: number;
  type: NotificationType;
  title: string;
  message?: string | null;
  payload?: NotificationPayload;
  priority?: NotificationPriority;
  expiresAt?: Date | null;
  /** Also sends an APNs push once committed; off by default so user-created notifications never push. */
  push?: boolean;
}

export const createNotification = withTransaction(
  async ({
    userId,
    type,
    title,
    message = null,
    payload = {},
    priority = NOTIFICATION_PRIORITIES.normal,
    expiresAt = null,
    push = false,
  }: CreateNotificationParams): Promise<NotificationModel> => {
    const notification = await Notifications.create({
      userId,
      type,
      title,
      message,
      payload,
      priority,
      expiresAt,
    });
    const created: NotificationModel = notification.toJSON();

    if (push && isApnsConfigured()) {
      // `void`: a slow APNs call must not hold up the commit hook.
      await runAfterCommit({ fn: () => void sendNotificationPush({ notification: created }) });
    }
    return created;
  },
);

// Attributes to return (excludes userId as it's not needed by frontend)
const NOTIFICATION_ATTRIBUTES = [
  'id',
  'type',
  'title',
  'message',
  'payload',
  'status',
  'priority',
  'createdAt',
  'readAt',
  'expiresAt',
] as const;

export const getNotificationById = async ({
  id,
  userId,
}: {
  id: string;
  userId: number;
}): Promise<Omit<NotificationModel, 'userId'> | null> => {
  const notification = await Notifications.findOne({
    attributes: [...NOTIFICATION_ATTRIBUTES],
    where: { id, userId },
  });

  return notification?.toJSON() ?? null;
};

interface GetNotificationsParams {
  userId: number;
  status?: NotificationStatus;
  type?: NotificationType;
  limit?: number;
  offset?: number;
}

export const getNotifications = async ({
  userId,
  status,
  type,
  limit = 50,
  offset = 0,
}: GetNotificationsParams): Promise<{ data: Omit<NotificationModel, 'userId'>[]; total: number }> => {
  const where: Record<string, unknown> = { userId };

  // If specific status requested, use it; otherwise exclude dismissed
  if (status) {
    where.status = status;
  } else {
    // By default, only return unread and read notifications (not dismissed)
    where.status = [NOTIFICATION_STATUSES.unread, NOTIFICATION_STATUSES.read];
  }

  if (type) where.type = type;

  const { rows, count } = await Notifications.findAndCountAll({
    attributes: [...NOTIFICATION_ATTRIBUTES],
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  return {
    data: rows.map((n) => n.toJSON()),
    total: count,
  };
};

export const markAsRead = withTransaction(async ({ id, userId }: { id: string; userId: number }): Promise<boolean> => {
  const [updated] = await Notifications.update(
    {
      status: NOTIFICATION_STATUSES.read,
      readAt: new Date(),
    },
    { where: { id, userId } },
  );

  return updated > 0;
});

export const markAllAsRead = withTransaction(async ({ userId }: { userId: number }): Promise<number> => {
  const [updated] = await Notifications.update(
    {
      status: NOTIFICATION_STATUSES.read,
      readAt: new Date(),
    },
    {
      where: {
        userId,
        status: NOTIFICATION_STATUSES.unread,
      },
    },
  );

  return updated;
});

export const dismissNotification = withTransaction(
  async ({ id, userId }: { id: string; userId: number }): Promise<boolean> => {
    const [updated] = await Notifications.update(
      { status: NOTIFICATION_STATUSES.dismissed },
      { where: { id, userId } },
    );

    return updated > 0;
  },
);

// No transaction needed for read-only count query
export const getUnreadCount = async ({ userId }: { userId: number }): Promise<number> => {
  return Notifications.count({
    where: {
      userId,
      status: NOTIFICATION_STATUSES.unread,
    },
  });
};
