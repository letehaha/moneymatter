import addTransactionsToTracker from '@controllers/trackers/add-transactions-to-tracker';
import createTracker from '@controllers/trackers/create-tracker';
import deleteTracker from '@controllers/trackers/delete-tracker';
import duplicateTracker from '@controllers/trackers/duplicate-tracker';
import editTracker from '@controllers/trackers/edit-tracker';
import getTrackerSpendingStats from '@controllers/trackers/get-spending-stats';
import getTrackerStats from '@controllers/trackers/get-stats';
import { getTrackerById, getTrackers } from '@controllers/trackers/get-trackers';
import createTrackerLine from '@controllers/trackers/lines/create-line';
import deleteTrackerLine from '@controllers/trackers/lines/delete-line';
import updateTrackerLine from '@controllers/trackers/lines/update-line';
import removeTransactionsFromTracker from '@controllers/trackers/remove-transactions-from-tracker';
import getTrackerSuggestions from '@controllers/trackers/suggestions/get-suggestions';
import {
  acceptSuggestions,
  rejectSuggestions,
  restoreSuggestions,
} from '@controllers/trackers/suggestions/resolve-suggestions';
import syncTrackerRules from '@controllers/trackers/sync-rules';
import archiveTracker from '@controllers/trackers/toggle-archive';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

// `/trackers` serves the user-facing "Trackers"; the "Budget" lives in budget-plans.route.ts.
const router = Router({});

router.use(authenticateSession);

router.get('/', getTrackers);
router.get('/:id', getTrackerById);
router.get('/:id/stats', getTrackerStats);
router.get('/:id/spending-stats', getTrackerSpendingStats);
router.get('/:id/suggestions', getTrackerSuggestions);
router.post('/', blockDemoUsers, checkBaseCurrencyLock, createTracker);
router.put('/:id', blockDemoUsers, checkBaseCurrencyLock, editTracker);
router.patch('/:id/archive', blockDemoUsers, checkBaseCurrencyLock, archiveTracker);
router.delete('/:id', blockDemoUsers, checkBaseCurrencyLock, deleteTracker);
router.post('/:id/duplicate', blockDemoUsers, checkBaseCurrencyLock, duplicateTracker);
router.post('/:id/sync', checkBaseCurrencyLock, syncTrackerRules);

router.post('/:id/lines', blockDemoUsers, checkBaseCurrencyLock, createTrackerLine);
router.put('/:id/lines/:lineId', blockDemoUsers, checkBaseCurrencyLock, updateTrackerLine);
router.delete('/:id/lines/:lineId', blockDemoUsers, checkBaseCurrencyLock, deleteTrackerLine);

router.post('/:id/transactions', blockDemoUsers, checkBaseCurrencyLock, addTransactionsToTracker);
router.delete('/:id/transactions', blockDemoUsers, checkBaseCurrencyLock, removeTransactionsFromTracker);

router.post('/:id/suggestions/accept', blockDemoUsers, checkBaseCurrencyLock, acceptSuggestions);
router.post('/:id/suggestions/reject', blockDemoUsers, checkBaseCurrencyLock, rejectSuggestions);
router.post('/:id/suggestions/restore', blockDemoUsers, checkBaseCurrencyLock, restoreSuggestions);

export default router;
