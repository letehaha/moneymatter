import {
  createReminder,
  deleteReminder,
  getReminderById,
  getRemindersForTag,
  updateReminder,
} from '@controllers/tag-reminders';
import {
  addTransactionsToTag,
  createTag,
  deleteTag,
  getTagById,
  getTags,
  removeTransactionsFromTag,
  updateTag,
} from '@controllers/tags';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.get('/', authenticateSession, getTags);
router.get('/:id', authenticateSession, getTagById);
router.post('/', authenticateSession, checkBaseCurrencyLock, createTag);
router.put('/:id', authenticateSession, checkBaseCurrencyLock, updateTag);
router.delete('/:id', authenticateSession, checkBaseCurrencyLock, deleteTag);

router.post('/:id/transactions', authenticateSession, checkBaseCurrencyLock, addTransactionsToTag);
router.delete('/:id/transactions', authenticateSession, checkBaseCurrencyLock, removeTransactionsFromTag);

// Tag reminders routes
router.get('/:tagId/reminders', authenticateSession, getRemindersForTag);
router.get('/:tagId/reminders/:id', authenticateSession, getReminderById);
router.post('/:tagId/reminders', authenticateSession, checkBaseCurrencyLock, createReminder);
router.put('/:tagId/reminders/:id', authenticateSession, checkBaseCurrencyLock, updateReminder);
router.delete('/:tagId/reminders/:id', authenticateSession, checkBaseCurrencyLock, deleteReminder);

export default router;
