import { NOTIFICATION_STATUSES, NOTIFICATION_TYPES } from '@bt/shared/types';
import { z } from 'zod';

type NotificationTypeValue = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];
type NotificationStatusValue = (typeof NOTIFICATION_STATUSES)[keyof typeof NOTIFICATION_STATUSES];

export const notificationTypeValues = Object.values(NOTIFICATION_TYPES) as [
  NotificationTypeValue,
  ...NotificationTypeValue[],
];

const notificationStatusValues = Object.values(NOTIFICATION_STATUSES) as [
  NotificationStatusValue,
  ...NotificationStatusValue[],
];

/**
 * The notification list filters of the REST controller.
 */
export const notificationTypeSchema = z.enum(notificationTypeValues);

export const notificationStatusSchema = z.enum(notificationStatusValues);
