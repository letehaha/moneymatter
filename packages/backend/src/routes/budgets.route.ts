import addTransactionsToBudget from '@controllers/budgets/add-transaction-to-budget';
import createBudget from '@controllers/budgets/create-budget';
import deleteBudget from '@controllers/budgets/delete-budgets';
import editBudget from '@controllers/budgets/edit-budget';
import { getBudgetById, getBudgets } from '@controllers/budgets/get-budgets';
import getCategoryBudgetTransactions from '@controllers/budgets/get-category-budget-transactions';
import getSpendingStats from '@controllers/budgets/get-spending-stats';
import getStats from '@controllers/budgets/get-stats';
import removeTransactionsFromBudget from '@controllers/budgets/remove-transaction-from-budget';
import toggleArchive from '@controllers/budgets/toggle-archive';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

router.get('/', getBudgets);
router.get('/:id', getBudgetById);
router.get('/:id/stats', getStats);
router.get('/:id/spending-stats', getSpendingStats);
router.get('/:id/category-transactions', getCategoryBudgetTransactions);
router.post('/', blockDemoUsers, checkBaseCurrencyLock, createBudget);
router.put('/:id', blockDemoUsers, checkBaseCurrencyLock, editBudget);
router.patch('/:id/archive', blockDemoUsers, checkBaseCurrencyLock, toggleArchive);
router.delete('/:id', blockDemoUsers, checkBaseCurrencyLock, deleteBudget);

router.post('/:id/transactions', blockDemoUsers, checkBaseCurrencyLock, addTransactionsToBudget);
router.delete('/:id/transactions', blockDemoUsers, checkBaseCurrencyLock, removeTransactionsFromBudget);

export default router;
