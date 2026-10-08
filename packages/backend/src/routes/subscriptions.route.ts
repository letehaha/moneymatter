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

router.use(authenticateSession);

router.get('/', getSubscriptions);
router.get('/summary', getSubscriptionsSummary);
router.get('/upcoming', getUpcomingPayments);

// Subscription candidate detection routes (must be before /:id)
router.get('/detect-candidates', detectCandidates);
router.get('/candidates', getCandidates);
router.post('/candidates/:id/accept', checkBaseCurrencyLock, acceptCandidate);
router.post('/candidates/:id/dismiss', checkBaseCurrencyLock, dismissCandidate);
router.get('/:id', getSubscriptionById);

router.post('/', checkBaseCurrencyLock, createSubscription);
router.put('/:id', checkBaseCurrencyLock, updateSubscription);
router.delete('/:id', checkBaseCurrencyLock, deleteSubscription);

router.patch('/:id/toggle-active', checkBaseCurrencyLock, toggleActive);

router.post('/:id/reset-logo', checkBaseCurrencyLock, resetLogo);

router.post('/:id/transactions', checkBaseCurrencyLock, linkTransactions);
router.delete('/:id/transactions', checkBaseCurrencyLock, unlinkTransactions);

router.get('/:id/suggest-matches', suggestMatches);

// Period payment routes
router.get('/:id/pay-preview', getPayPreview);
router.get('/:id/periods', getPeriods);
router.post('/:id/periods/:periodId/pay', checkBaseCurrencyLock, markPeriodPaid);
router.post('/:id/periods/:periodId/skip', checkBaseCurrencyLock, skipPeriod);
router.post('/:id/periods/:periodId/unlink', checkBaseCurrencyLock, unlinkPeriodTransaction);
router.post('/:id/periods/:periodId/revert', checkBaseCurrencyLock, revertPeriod);

export default router;
