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

router.use(authenticateSession);

router.get('/', getTags);
router.get('/:id', getTagById);
router.post('/', checkBaseCurrencyLock, createTag);
router.put('/:id', checkBaseCurrencyLock, updateTag);
router.delete('/:id', checkBaseCurrencyLock, deleteTag);

router.post('/:id/transactions', checkBaseCurrencyLock, addTransactionsToTag);
router.delete('/:id/transactions', checkBaseCurrencyLock, removeTransactionsFromTag);

// Tag reminders routes
router.get('/:tagId/reminders', getRemindersForTag);
router.get('/:tagId/reminders/:id', getReminderById);
router.post('/:tagId/reminders', checkBaseCurrencyLock, createReminder);
router.put('/:tagId/reminders/:id', checkBaseCurrencyLock, updateReminder);
router.delete('/:tagId/reminders/:id', checkBaseCurrencyLock, deleteReminder);

export default router;
