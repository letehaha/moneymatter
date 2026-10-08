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

router.get('/', authenticateSession, listPayees);
router.post('/', authenticateSession, checkBaseCurrencyLock, createPayee);

// Full minimal payee set for id→name/logo resolution. Must precede `/:id` so
// Express doesn't capture the literal `lookup` segment as a Payee id.
router.get('/lookup', authenticateSession, lookupPayees);

// Bulk-update sub-resource. Precedes `/:id` patterns for the same reason as
// `/ignored-names` below – Express's path matcher would otherwise treat the
// literal segment as a Payee id.
router.patch('/bulk-categorization-mode', authenticateSession, checkBaseCurrencyLock, bulkUpdateCategorizationMode);
router.post('/bulk-delete', authenticateSession, checkBaseCurrencyLock, bulkDeletePayees);

// Ignored-names sub-resource. Routes precede `/:id` patterns so Express's
// path matcher doesn't capture the literal segment as a Payee id.
router.get('/ignored-names', authenticateSession, listIgnoredNames);
router.post('/ignored-names', authenticateSession, checkBaseCurrencyLock, addIgnoredName);
router.delete('/ignored-names/:id', authenticateSession, checkBaseCurrencyLock, removeIgnoredName);

router.get('/:id', authenticateSession, getPayee);
router.patch('/:id', authenticateSession, checkBaseCurrencyLock, updatePayee);
router.delete('/:id', authenticateSession, checkBaseCurrencyLock, deletePayee);
router.post('/:id/merge', authenticateSession, checkBaseCurrencyLock, mergePayees);
router.post('/:id/apply-tags', authenticateSession, checkBaseCurrencyLock, applyTagsToExisting);
router.post('/:id/aliases', authenticateSession, checkBaseCurrencyLock, createPayeeAlias);
router.delete('/:id/aliases/:aliasId', authenticateSession, checkBaseCurrencyLock, deletePayeeAlias);
router.post('/:id/reset-logo', authenticateSession, checkBaseCurrencyLock, resetLogo);

export default router;
