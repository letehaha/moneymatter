import * as statsController from '@controllers/stats.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

router.get('/balance-history', statsController.getBalanceHistory);
router.get('/total-balance', statsController.getTotalBalance);
router.get('/expenses-amount-for-period', statsController.getExpensesAmountForPeriod);
router.get('/spendings-by-categories', statsController.getSpendingsByCategories);
router.get('/combined-balance-history', statsController.getCombinedBalanceHistory);
router.get('/cash-flow', statsController.getCashFlow);
router.get('/net-worth-drivers', statsController.getNetWorthDrivers);
router.get('/net-worth-history', statsController.getNetWorthHistory);
router.get('/investment-contributions', statsController.getInvestmentContributions);
router.get('/venture-contributions', statsController.getVentureContributions);
router.get('/pivot', statsController.getPivotReport);
router.get('/cumulative', statsController.getCumulativeData);
router.get('/earliest-transaction-date', statsController.getEarliestTransactionDate);

export default router;
