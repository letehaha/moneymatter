import {
  addIgnoredName,
  applyTagsToExisting,
  bulkDeletePayees,
  bulkUpdateCategorizationMode,
  createPayee,
  createPayeeAlias,
  deletePayee,
  deletePayeeAlias,
  getPayee,
  listIgnoredNames,
  listPayees,
  lookupPayees,
  mergePayees,
  removeIgnoredName,
  resetLogo,
  updatePayee,
} from '@controllers/payees';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

router.use(authenticateSession);

router.get('/', listPayees);
router.post('/', checkBaseCurrencyLock, createPayee);

// Full minimal payee set for id→name/logo resolution. Must precede `/:id` so
// Express doesn't capture the literal `lookup` segment as a Payee id.
router.get('/lookup', lookupPayees);

// Bulk-update sub-resource. Precedes `/:id` patterns for the same reason as
// `/ignored-names` below – Express's path matcher would otherwise treat the
// literal segment as a Payee id.
router.patch('/bulk-categorization-mode', checkBaseCurrencyLock, bulkUpdateCategorizationMode);
router.post('/bulk-delete', checkBaseCurrencyLock, bulkDeletePayees);

// Ignored-names sub-resource. Routes precede `/:id` patterns so Express's
// path matcher doesn't capture the literal segment as a Payee id.
router.get('/ignored-names', listIgnoredNames);
router.post('/ignored-names', checkBaseCurrencyLock, addIgnoredName);
router.delete('/ignored-names/:id', checkBaseCurrencyLock, removeIgnoredName);

router.get('/:id', getPayee);
router.patch('/:id', checkBaseCurrencyLock, updatePayee);
router.delete('/:id', checkBaseCurrencyLock, deletePayee);
router.post('/:id/merge', checkBaseCurrencyLock, mergePayees);
router.post('/:id/apply-tags', checkBaseCurrencyLock, applyTagsToExisting);
router.post('/:id/aliases', checkBaseCurrencyLock, createPayeeAlias);
router.delete('/:id/aliases/:aliasId', checkBaseCurrencyLock, deletePayeeAlias);
router.post('/:id/reset-logo', checkBaseCurrencyLock, resetLogo);

export default router;
