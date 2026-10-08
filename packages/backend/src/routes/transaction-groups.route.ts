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

router.use(authenticateSession);

router.get('/', getTransactionGroups);
router.get('/:id', getTransactionGroupById);
router.post('/', checkBaseCurrencyLock, createTransactionGroup);
router.put('/:id', checkBaseCurrencyLock, updateTransactionGroup);
router.delete('/:id', checkBaseCurrencyLock, deleteTransactionGroup);

router.post('/:id/transactions', checkBaseCurrencyLock, addTransactionsToGroup);
router.delete('/:id/transactions', checkBaseCurrencyLock, removeTransactionsFromGroup);

export default router;
