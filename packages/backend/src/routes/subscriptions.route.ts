import acceptCandidate from '@controllers/subscriptions/accept-candidate';
import createSubscription from '@controllers/subscriptions/create-subscription';
import deleteSubscription from '@controllers/subscriptions/delete-subscription';
import detectCandidates from '@controllers/subscriptions/detect-candidates';
import dismissCandidate from '@controllers/subscriptions/dismiss-candidate';
import getCandidates from '@controllers/subscriptions/get-candidates';
import getPayPreview from '@controllers/subscriptions/get-pay-preview';
import getPeriods from '@controllers/subscriptions/get-periods';
import { getSubscriptionById, getSubscriptions } from '@controllers/subscriptions/get-subscriptions';
import getSubscriptionsSummary from '@controllers/subscriptions/get-subscriptions-summary';
import getUpcomingPayments from '@controllers/subscriptions/get-upcoming-payments';
import linkTransactions from '@controllers/subscriptions/link-transactions';
import markPeriodPaid from '@controllers/subscriptions/mark-period-paid';
import resetLogo from '@controllers/subscriptions/reset-logo';
import revertPeriod from '@controllers/subscriptions/revert-period';
import skipPeriod from '@controllers/subscriptions/skip-period';
import suggestMatches from '@controllers/subscriptions/suggest-matches';
import toggleActive from '@controllers/subscriptions/toggle-active';
import unlinkPeriodTransaction from '@controllers/subscriptions/unlink-transaction';
import unlinkTransactions from '@controllers/subscriptions/unlink-transactions';
import updateSubscription from '@controllers/subscriptions/update-subscription';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.get('/', authenticateSession, getSubscriptions);
router.get('/summary', authenticateSession, getSubscriptionsSummary);
router.get('/upcoming', authenticateSession, getUpcomingPayments);

// Subscription candidate detection routes (must be before /:id)
router.get('/detect-candidates', authenticateSession, detectCandidates);
router.get('/candidates', authenticateSession, getCandidates);
router.post('/candidates/:id/accept', authenticateSession, checkBaseCurrencyLock, acceptCandidate);
router.post('/candidates/:id/dismiss', authenticateSession, checkBaseCurrencyLock, dismissCandidate);
router.get('/:id', authenticateSession, getSubscriptionById);

router.post('/', authenticateSession, checkBaseCurrencyLock, createSubscription);
router.put('/:id', authenticateSession, checkBaseCurrencyLock, updateSubscription);
router.delete('/:id', authenticateSession, checkBaseCurrencyLock, deleteSubscription);

router.patch('/:id/toggle-active', authenticateSession, checkBaseCurrencyLock, toggleActive);

router.post('/:id/reset-logo', authenticateSession, checkBaseCurrencyLock, resetLogo);

router.post('/:id/transactions', authenticateSession, checkBaseCurrencyLock, linkTransactions);
router.delete('/:id/transactions', authenticateSession, checkBaseCurrencyLock, unlinkTransactions);

router.get('/:id/suggest-matches', authenticateSession, suggestMatches);

// Period payment routes
router.get('/:id/pay-preview', authenticateSession, getPayPreview);
router.get('/:id/periods', authenticateSession, getPeriods);
router.post('/:id/periods/:periodId/pay', authenticateSession, checkBaseCurrencyLock, markPeriodPaid);
router.post('/:id/periods/:periodId/skip', authenticateSession, checkBaseCurrencyLock, skipPeriod);
router.post('/:id/periods/:periodId/unlink', authenticateSession, checkBaseCurrencyLock, unlinkPeriodTransaction);
router.post('/:id/periods/:periodId/revert', authenticateSession, checkBaseCurrencyLock, revertPeriod);

export default router;
