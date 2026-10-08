import * as statsController from '@controllers/stats.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { Router } from 'express';

const router = Router({});

router.get('/balance-history', authenticateSession, statsController.getBalanceHistory);
router.get('/total-balance', authenticateSession, statsController.getTotalBalance);
router.get('/expenses-amount-for-period', authenticateSession, statsController.getExpensesAmountForPeriod);
router.get('/spendings-by-categories', authenticateSession, statsController.getSpendingsByCategories);
router.get('/combined-balance-history', authenticateSession, statsController.getCombinedBalanceHistory);
router.get('/cash-flow', authenticateSession, statsController.getCashFlow);
router.get('/net-worth-drivers', authenticateSession, statsController.getNetWorthDrivers);
router.get('/net-worth-history', authenticateSession, statsController.getNetWorthHistory);
router.get('/investment-contributions', authenticateSession, statsController.getInvestmentContributions);
router.get('/venture-contributions', authenticateSession, statsController.getVentureContributions);
router.get('/pivot', authenticateSession, statsController.getPivotReport);
router.get('/cumulative', authenticateSession, statsController.getCumulativeData);
router.get('/earliest-transaction-date', authenticateSession, statsController.getEarliestTransactionDate);

export default router;
