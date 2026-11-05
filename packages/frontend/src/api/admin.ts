import { api } from '@/api/_api';
import type { BroadcastSystemNotificationRequest, BroadcastSystemNotificationResponse } from '@bt/shared/types';

export const broadcastSystemNotification = (
  payload: BroadcastSystemNotificationRequest,
): Promise<BroadcastSystemNotificationResponse> => api.post('/admin/notifications/broadcast', payload);
