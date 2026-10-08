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

router.use(authenticateSession);

router.get('/', getLoans);
router.get('/:id', getLoanById);
router.get('/:id/balance-history', getBalanceHistory);
router.post('/', checkBaseCurrencyLock, createLoan);
router.patch('/:id', checkBaseCurrencyLock, updateLoan);
router.delete('/:id', checkBaseCurrencyLock, deleteLoan);
router.post('/:id/events', checkBaseCurrencyLock, appendNoteEvent);
router.post('/:id/link-payments', checkBaseCurrencyLock, linkPayments);
router.post('/:id/unlink-payment', checkBaseCurrencyLock, unlinkPayment);

export default router;
