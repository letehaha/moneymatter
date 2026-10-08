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

router.use(authenticateSession);

router.get('/', getTransactionTemplates);
router.post('/', checkBaseCurrencyLock, createTransactionTemplate);
router.put('/:id', checkBaseCurrencyLock, updateTransactionTemplate);
router.delete('/:id', checkBaseCurrencyLock, deleteTransactionTemplate);

export default router;
