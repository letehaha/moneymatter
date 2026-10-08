import applyAutomationToHistory from '@controllers/transaction-automations/apply-to-history';
import createAutomation from '@controllers/transaction-automations/create-automation';
import deleteAutomation from '@controllers/transaction-automations/delete-automation';
import listAutomations from '@controllers/transaction-automations/list-automations';
import previewAutomation from '@controllers/transaction-automations/preview-automation';
import reorderAutomations from '@controllers/transaction-automations/reorder-automations';
import updateAutomation from '@controllers/transaction-automations/update-automation';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

router.get('/', listAutomations);
router.post('/', checkBaseCurrencyLock, createAutomation);

// Static paths before `/:id` so a literal segment is never read as an id.
router.put('/reorder', checkBaseCurrencyLock, reorderAutomations);
router.post('/preview', checkBaseCurrencyLock, previewAutomation);

router.post('/:id/apply', checkBaseCurrencyLock, applyAutomationToHistory);

router.patch('/:id', checkBaseCurrencyLock, updateAutomation);
router.delete('/:id', checkBaseCurrencyLock, deleteAutomation);

export default router;
