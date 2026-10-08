import appendNoteEvent from '@controllers/loans/append-note-event';
import createLoan from '@controllers/loans/create-loan';
import deleteLoan from '@controllers/loans/delete-loan';
import getBalanceHistory from '@controllers/loans/get-balance-history';
import getLoanById from '@controllers/loans/get-loan-by-id';
import getLoans from '@controllers/loans/get-loans';
import linkPayments from '@controllers/loans/link-payments';
import unlinkPayment from '@controllers/loans/unlink-payment';
import updateLoan from '@controllers/loans/update-loan';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.get('/', authenticateSession, getLoans);
router.get('/:id', authenticateSession, getLoanById);
router.get('/:id/balance-history', authenticateSession, getBalanceHistory);
router.post('/', authenticateSession, checkBaseCurrencyLock, createLoan);
router.patch('/:id', authenticateSession, checkBaseCurrencyLock, updateLoan);
router.delete('/:id', authenticateSession, checkBaseCurrencyLock, deleteLoan);
router.post('/:id/events', authenticateSession, checkBaseCurrencyLock, appendNoteEvent);
router.post('/:id/link-payments', authenticateSession, checkBaseCurrencyLock, linkPayments);
router.post('/:id/unlink-payment', authenticateSession, checkBaseCurrencyLock, unlinkPayment);

export default router;
