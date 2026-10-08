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

router.get('/', authenticateSession, getAccounts);
router.get('/:id', authenticateSession, getAccountById);
router.get('/:id/transaction-count', authenticateSession, getAccountTransactionCount);
router.post('/', authenticateSession, checkBaseCurrencyLock, createAccount);
router.put('/:id', authenticateSession, checkBaseCurrencyLock, updateAccount);
router.delete('/:id', authenticateSession, checkBaseCurrencyLock, deleteAccount);
router.post('/:id/unlink', authenticateSession, checkBaseCurrencyLock, unlinkAccountFromBankConnection);
router.post('/:id/link', authenticateSession, checkBaseCurrencyLock, linkAccountToBankConnection);
router.post('/:id/balance-adjustment', authenticateSession, checkBaseCurrencyLock, balanceAdjustment);

export default router;
