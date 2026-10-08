import {
  createTransactionTemplate,
  deleteTransactionTemplate,
  getTransactionTemplates,
  updateTransactionTemplate,
} from '@controllers/transaction-templates';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.get('/', authenticateSession, getTransactionTemplates);
router.post('/', authenticateSession, checkBaseCurrencyLock, createTransactionTemplate);
router.put('/:id', authenticateSession, checkBaseCurrencyLock, updateTransactionTemplate);
router.delete('/:id', authenticateSession, checkBaseCurrencyLock, deleteTransactionTemplate);

export default router;
