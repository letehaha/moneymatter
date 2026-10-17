import { api } from '@/api/_api';
import { NotificationModel, NotificationStatus, NotificationType } from '@bt/shared/types';

interface GetNotificationsParams {
  status?: NotificationStatus;
  type?: NotificationType;
  limit?: number;
  offset?: number;
}

export type NotificationStruct = Omit<NotificationModel, 'userId'>;

export const getNotifications = async (params: GetNotificationsParams = {}): Promise<NotificationStruct[]> => {
  const result: { data: NotificationStruct[] } = await api.get('/notifications', params);
  return result.data;
};

/** The backend answers 200 with a null body for an id that is missing or belongs to another account. */
export const getNotificationById = async ({ id }: { id: string }): Promise<NotificationStruct | null> => {
  const result: NotificationStruct | null = await api.get(`/notifications/${id}`);
  return result ?? null;
};

export const getUnreadCount = async (): Promise<number> => {
  const result = await api.get('/notifications/unread-count');
  return result.count;
};

export const markAsRead = async ({ id }: { id: string }): Promise<boolean> => {
  const result = await api.post(`/notifications/${id}/read`);
  return result.success;
};

export const markAllAsRead = async (): Promise<number> => {
  const result = await api.post('/notifications/read-all');
  return result.updated;
};

export const dismissNotification = async ({ id }: { id: string }): Promise<boolean> => {
  const result = await api.post(`/notifications/${id}/dismiss`);
  return result.success;
};
