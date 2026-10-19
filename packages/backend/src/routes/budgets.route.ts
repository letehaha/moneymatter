import addTransactionsToBudget from '@controllers/budgets/add-transaction-to-budget';
import createBudget from '@controllers/budgets/create-budget';
import deleteBudget from '@controllers/budgets/delete-budgets';
import duplicateBudget from '@controllers/budgets/duplicate-budget';
import editBudget from '@controllers/budgets/edit-budget';
import { getBudgetById, getBudgets } from '@controllers/budgets/get-budgets';
import getCategoryBudgetTransactions from '@controllers/budgets/get-category-budget-transactions';
import getSpendingStats from '@controllers/budgets/get-spending-stats';
import getStats from '@controllers/budgets/get-stats';
import createTrackerLine from '@controllers/budgets/lines/create-line';
import deleteTrackerLine from '@controllers/budgets/lines/delete-line';
import updateTrackerLine from '@controllers/budgets/lines/update-line';
import removeTransactionsFromBudget from '@controllers/budgets/remove-transaction-from-budget';
import getTrackerSuggestions from '@controllers/budgets/suggestions/get-suggestions';
import {
  acceptSuggestions,
  rejectSuggestions,
  restoreSuggestions,
} from '@controllers/budgets/suggestions/resolve-suggestions';
import toggleArchive from '@controllers/budgets/toggle-archive';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

// `/budgets` serves the user-facing "Trackers"; the "Budget" lives in budget-plans.route.ts.
const router = Router({});

router.use(authenticateSession);

router.get('/', getBudgets);
router.get('/:id', getBudgetById);
router.get('/:id/stats', getStats);
router.get('/:id/spending-stats', getSpendingStats);
router.get('/:id/category-transactions', getCategoryBudgetTransactions);
router.get('/:id/suggestions', getTrackerSuggestions);
router.post('/', blockDemoUsers, checkBaseCurrencyLock, createBudget);
router.put('/:id', blockDemoUsers, checkBaseCurrencyLock, editBudget);
router.patch('/:id/archive', blockDemoUsers, checkBaseCurrencyLock, toggleArchive);
router.delete('/:id', blockDemoUsers, checkBaseCurrencyLock, deleteBudget);
router.post('/:id/duplicate', blockDemoUsers, checkBaseCurrencyLock, duplicateBudget);

router.post('/:id/lines', blockDemoUsers, checkBaseCurrencyLock, createTrackerLine);
router.put('/:id/lines/:lineId', blockDemoUsers, checkBaseCurrencyLock, updateTrackerLine);
router.delete('/:id/lines/:lineId', blockDemoUsers, checkBaseCurrencyLock, deleteTrackerLine);

router.post('/:id/transactions', blockDemoUsers, checkBaseCurrencyLock, addTransactionsToBudget);
router.delete('/:id/transactions', blockDemoUsers, checkBaseCurrencyLock, removeTransactionsFromBudget);

router.post('/:id/suggestions/accept', blockDemoUsers, checkBaseCurrencyLock, acceptSuggestions);
router.post('/:id/suggestions/reject', blockDemoUsers, checkBaseCurrencyLock, rejectSuggestions);
router.post('/:id/suggestions/restore', blockDemoUsers, checkBaseCurrencyLock, restoreSuggestions);

export default router;
