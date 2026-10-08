import {
  createAccount,
  deleteAccount,
  getAccountById,
  getAccounts,
  updateAccount,
} from '@controllers/accounts.controller';
import balanceAdjustment from '@controllers/accounts/balance-adjustment';
import linkAccountToBankConnection from '@controllers/accounts/link-to-bank-connection';
import getAccountTransactionCount from '@controllers/accounts/transaction-count';
import unlinkAccountFromBankConnection from '@controllers/accounts/unlink-from-bunk-connection';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

router.get('/', getAccounts);
router.get('/:id', getAccountById);
router.get('/:id/transaction-count', getAccountTransactionCount);
router.post('/', checkBaseCurrencyLock, createAccount);
router.put('/:id', checkBaseCurrencyLock, updateAccount);
router.delete('/:id', checkBaseCurrencyLock, deleteAccount);
router.post('/:id/unlink', checkBaseCurrencyLock, unlinkAccountFromBankConnection);
router.post('/:id/link', checkBaseCurrencyLock, linkAccountToBankConnection);
router.post('/:id/balance-adjustment', checkBaseCurrencyLock, balanceAdjustment);

export default router;
