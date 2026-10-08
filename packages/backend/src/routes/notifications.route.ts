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

// Get all notifications for the authenticated user
router.get('/', authenticateSession, getNotifications);

// Get unread count
router.get('/unread-count', authenticateSession, getUnreadCount);

// Get a specific notification
router.get('/:id', authenticateSession, getNotificationById);

// Create a notification (primarily for internal/admin use, but exposed for testing)
router.post('/', authenticateSession, checkBaseCurrencyLock, createNotification);

// Mark a specific notification as read
router.post('/:id/read', authenticateSession, markAsRead);

// Mark all notifications as read
router.post('/read-all', authenticateSession, markAllAsRead);

// Dismiss a notification
router.post('/:id/dismiss', authenticateSession, checkBaseCurrencyLock, dismissNotification);

export default router;
