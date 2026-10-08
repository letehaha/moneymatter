import {
  createNotification,
  dismissNotification,
  getNotificationById,
  getNotifications,
  getUnreadCount,
  markAllAsRead,
  markAsRead,
} from '@controllers/notifications.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

// Get all notifications for the authenticated user
router.get('/', getNotifications);

// Get unread count
router.get('/unread-count', getUnreadCount);

// Get a specific notification
router.get('/:id', getNotificationById);

// Create a notification (primarily for internal/admin use, but exposed for testing)
router.post('/', checkBaseCurrencyLock, createNotification);

// Mark a specific notification as read
router.post('/:id/read', markAsRead);

// Mark all notifications as read
router.post('/read-all', markAllAsRead);

// Dismiss a notification
router.post('/:id/dismiss', checkBaseCurrencyLock, dismissNotification);

export default router;
