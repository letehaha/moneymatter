import { NotificationModel, NotificationType } from '@bt/shared/types';
import * as helpers from '@tests/helpers';
import { Response } from 'express';

interface GetNotificationsParams {
  status?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export async function getNotifications({ raw, ...params }: GetNotificationsParams & { raw?: false }): Promise<Response>;
export async function getNotifications({
  raw,
  ...params
}: GetNotificationsParams & { raw?: true }): Promise<Omit<NotificationModel, 'userId'>[]>;
export async function getNotifications({
  raw = true,
  ...params
}: GetNotificationsParams & { raw?: boolean }): Promise<Response | Omit<NotificationModel, 'userId'>[]> {
  const result = await helpers.makeRequest({
    method: 'get',
    url: '/notifications',
    payload: params,
    raw,
  });

  // API returns {data: [...], meta: {...}}, extract data array
  return raw ? result.data : result;
}

export async function getNotificationById({ raw, ...params }: { id: string; raw?: false }): Promise<Response>;
export async function getNotificationById({
  raw,
  ...params
}: {
  id: string;
  raw?: true;
}): Promise<Omit<NotificationModel, 'userId'> | null>;
export async function getNotificationById({
  id,
  raw = true,
}: {
  id: string;
  raw?: boolean;
}): Promise<Response | Omit<NotificationModel, 'userId'> | null> {
  const result = await helpers.makeRequest({
    method: 'get',
    url: `/notifications/${id}`,
    raw,
  });

  return result;
}

export async function getUnreadCount({ raw }: { raw?: false }): Promise<Response>;
export async function getUnreadCount({ raw }: { raw?: true }): Promise<{ count: number }>;
export async function getUnreadCount({ raw = true }: { raw?: boolean } = {}): Promise<Response | { count: number }> {
  const result = await helpers.makeRequest({
    method: 'get',
    url: '/notifications/unread-count',
    raw,
  });

  return result;
}

export async function markAsRead({ raw, ...params }: { id: string; raw?: false }): Promise<Response>;
export async function markAsRead({ raw, ...params }: { id: string; raw?: true }): Promise<{ success: boolean }>;
export async function markAsRead({
  id,
  raw = true,
}: {
  id: string;
  raw?: boolean;
}): Promise<Response | { success: boolean }> {
  const result = await helpers.makeRequest({
    method: 'post',
    url: `/notifications/${id}/read`,
    raw,
  });

  return result;
}

export async function markAllAsRead({ raw }: { raw?: false }): Promise<Response>;
export async function markAllAsRead({ raw }: { raw?: true }): Promise<{ updated: number }>;
export async function markAllAsRead({ raw = true }: { raw?: boolean } = {}): Promise<Response | { updated: number }> {
  const result = await helpers.makeRequest({
    method: 'post',
    url: '/notifications/read-all',
    raw,
  });

  return result;
}

export async function dismissNotification({ raw, ...params }: { id: string; raw?: false }): Promise<Response>;
export async function dismissNotification({
  raw,
  ...params
}: {
  id: string;
  raw?: true;
}): Promise<{ success: boolean }>;
export async function dismissNotification({
  id,
  raw = true,
}: {
  id: string;
  raw?: boolean;
}): Promise<Response | { success: boolean }> {
  const result = await helpers.makeRequest({
    method: 'post',
    url: `/notifications/${id}/dismiss`,
    raw,
  });

  return result;
}

export async function createNotification<R extends boolean | undefined = undefined>({
  payload,
  raw,
}: {
  payload: {
    type: NotificationType;
    title: string;
    message?: string;
    payload?: Record<string, unknown>;
    priority?: string;
    expiresAt?: string;
  };
  raw?: R;
}) {
  return helpers.makeRequest<Omit<NotificationModel, 'userId'>, R>({
    method: 'post',
    url: '/notifications',
    payload,
    raw,
  });
}
