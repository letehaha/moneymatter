import { ATTACHMENT_MAX_FILE_BYTES, FEATURES } from '@bt/shared/types';
import { listAttachmentsController, uploadAttachmentController } from '@controllers/attachments.controller';
import {
  getTransactionById,
  getTransactionsByTransferId,
  linkTransactions,
} from '@controllers/transactions.controller';
import bulkDelete from '@controllers/transactions.controller/bulk-delete';
import bulkUpdate from '@controllers/transactions.controller/bulk-update';
import createTransaction from '@controllers/transactions.controller/create-transaction';
import deleteTransaction from '@controllers/transactions.controller/delete-transaction';
import getPlannedSummary from '@controllers/transactions.controller/get-planned-summary';
import getPortfolioLink from '@controllers/transactions.controller/get-portfolio-link';
import getTransactions from '@controllers/transactions.controller/get-transaction';
import getTransactionsByIds from '@controllers/transactions.controller/get-transactions-by-ids';
import getTransactionsSummary from '@controllers/transactions.controller/get-transactions-summary';
import linkToPortfolio from '@controllers/transactions.controller/link-to-portfolio';
import matchInvoice from '@controllers/transactions.controller/match-invoice';
import * as reconciliation from '@controllers/transactions.controller/reconciliation';
import createRefund from '@controllers/transactions.controller/refunds/create-refund';
import deleteRefund from '@controllers/transactions.controller/refunds/delete-refund';
import getRefund from '@controllers/transactions.controller/refunds/get-refund';
import getRefundRecommendations from '@controllers/transactions.controller/refunds/get-refund-recommendations';
import getRefunds from '@controllers/transactions.controller/refunds/get-refunds';
import getRefundsForTransactionById from '@controllers/transactions.controller/refunds/get-refunds-for-transaction-by-id';
import rematchInvoice from '@controllers/transactions.controller/rematch-invoice';
import deleteSplit from '@controllers/transactions.controller/splits/delete-split';
import bulkScanTransferRecommendations from '@controllers/transactions.controller/transfer-linking/bulk-scan-transfer-recommendations';
import dismissTransferSuggestion from '@controllers/transactions.controller/transfer-linking/dismiss-transfer-suggestion';
import getTransferRecommendations from '@controllers/transactions.controller/transfer-linking/get-transfer-recommendations';
import unlinkTransferTransactions from '@controllers/transactions.controller/transfer-linking/unlink-transfer-transactions';
import unlinkFromPortfolio from '@controllers/transactions.controller/unlink-from-portfolio';
import updateTransaction from '@controllers/transactions.controller/update-transaction';
import { authenticateSessionOrUploadToken } from '@middlewares/attachment-upload-auth';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { requireFeature, requireFeatureOrTrial } from '@middlewares/entitlements';
import { attachmentUploadRateLimit } from '@middlewares/rate-limit';
import express, { Router } from 'express';

const router = Router({});

// Registered before the blanket session auth: uploads may carry an upload token instead of a session.
router.post(
  '/:transactionId/attachments',
  authenticateSessionOrUploadToken,
  requireFeature(FEATURES.attachments),
  attachmentUploadRateLimit,
  express.raw({ type: 'application/octet-stream', limit: ATTACHMENT_MAX_FILE_BYTES }),
  uploadAttachmentController,
);

router.use(authenticateSession);

// Define all named routes level above to avoid matching with /:id
router.get('/refund', getRefund);
router.get('/refunds', getRefunds);
router.get('/refund-recommendations', getRefundRecommendations);
router.get('/planned-summary', getPlannedSummary);
router.get('/summary', getTransactionsSummary);
router.get('/transfer-recommendations', getTransferRecommendations);
router.post('/transfer-recommendations/bulk-scan', checkBaseCurrencyLock, bulkScanTransferRecommendations);
router.post('/transfer-recommendations/dismiss', checkBaseCurrencyLock, dismissTransferSuggestion);
router.post('/refund', checkBaseCurrencyLock, createRefund);
// Reads the uploaded invoice and ranks candidates; nothing is stored, so no base-currency lock.
router.post(
  '/match-invoice',
  requireFeature(FEATURES.attachments),
  requireFeatureOrTrial(FEATURES.invoice_matching),
  attachmentUploadRateLimit,
  express.raw({ type: 'application/octet-stream', limit: ATTACHMENT_MAX_FILE_BYTES }),
  matchInvoice,
);
router.post(
  '/match-invoice/candidates',
  // No AI and no try spent, so a user whose free tries are gone can still correct the
  // fields of the invoice they just read. Only the attachments gate applies.
  requireFeature(FEATURES.attachments),
  attachmentUploadRateLimit,
  rematchInvoice,
);
router.delete('/refund', checkBaseCurrencyLock, deleteRefund);

router.get('/reconciliation/history', reconciliation.historyController);
router.get('/reconciliation/stuck-pending', reconciliation.stuckPendingController);
router.post('/reconciliation/remove', checkBaseCurrencyLock, reconciliation.removeController);
router.post('/reconciliation/merge', checkBaseCurrencyLock, reconciliation.mergeController);
router.post('/reconciliation/restore', checkBaseCurrencyLock, reconciliation.restoreController);
router.post('/reconciliation/keep-as-booked', checkBaseCurrencyLock, reconciliation.keepAsBookedController);
router.post(
  '/reconciliation/stuck-pending/check',
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  reconciliation.checkStuckPendingController,
);

// Split routes
router.delete('/splits/:splitId', checkBaseCurrencyLock, deleteSplit);

// Portfolio linking routes
router.post('/:transactionId/link-to-portfolio', checkBaseCurrencyLock, linkToPortfolio);
router.post('/:transactionId/unlink-from-portfolio', checkBaseCurrencyLock, unlinkFromPortfolio);
router.get('/:transactionId/portfolio-link', getPortfolioLink);

// Listing stays ungated so a lapsed user can still reach their own files.
router.get('/:transactionId/attachments', listAttachmentsController);

router.get('/', getTransactions);
router.get('/by-ids', getTransactionsByIds);
router.get('/:id', getTransactionById);
router.get('/:id/refunds', getRefundsForTransactionById);
router.get('/transfer/:transferId', getTransactionsByTransferId);
router.post('/', checkBaseCurrencyLock, createTransaction);
router.put('/unlink', checkBaseCurrencyLock, unlinkTransferTransactions);
router.put('/link', checkBaseCurrencyLock, linkTransactions);
router.put('/bulk', checkBaseCurrencyLock, bulkUpdate);
router.post('/bulk-delete', checkBaseCurrencyLock, bulkDelete);
router.put('/:id', checkBaseCurrencyLock, updateTransaction);
router.delete('/:id', checkBaseCurrencyLock, deleteTransaction);

export default router;
