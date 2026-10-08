import {
  addTransactionsToGroup,
  createTransactionGroup,
  deleteTransactionGroup,
  getTransactionGroupById,
  getTransactionGroups,
  removeTransactionsFromGroup,
  updateTransactionGroup,
} from '@controllers/transaction-groups';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.get('/', authenticateSession, getTransactionGroups);
router.get('/:id', authenticateSession, getTransactionGroupById);
router.post('/', authenticateSession, checkBaseCurrencyLock, createTransactionGroup);
router.put('/:id', authenticateSession, checkBaseCurrencyLock, updateTransactionGroup);
router.delete('/:id', authenticateSession, checkBaseCurrencyLock, deleteTransactionGroup);

router.post('/:id/transactions', authenticateSession, checkBaseCurrencyLock, addTransactionsToGroup);
router.delete('/:id/transactions', authenticateSession, checkBaseCurrencyLock, removeTransactionsFromGroup);

export default router;
