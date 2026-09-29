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
import { validateEndpoint } from '@middlewares/validations';
import express, { Router } from 'express';

const router = Router({});

// Define all named routes level above to avoid matching with /:id
router.get('/refund', authenticateSession, validateEndpoint(getRefund.schema), getRefund.handler);
router.get('/refunds', authenticateSession, validateEndpoint(getRefunds.schema), getRefunds.handler);
router.get(
  '/refund-recommendations',
  authenticateSession,
  validateEndpoint(getRefundRecommendations.schema),
  getRefundRecommendations.handler,
);
router.get(
  '/planned-summary',
  authenticateSession,
  validateEndpoint(getPlannedSummary.schema),
  getPlannedSummary.handler,
);
router.get(
  '/transfer-recommendations',
  authenticateSession,
  validateEndpoint(getTransferRecommendations.schema),
  getTransferRecommendations.handler,
);
router.post(
  '/transfer-recommendations/bulk-scan',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(bulkScanTransferRecommendations.schema),
  bulkScanTransferRecommendations.handler,
);
router.post(
  '/transfer-recommendations/dismiss',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(dismissTransferSuggestion.schema),
  dismissTransferSuggestion.handler,
);
router.post(
  '/refund',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(createRefund.schema),
  createRefund.handler,
);
// Reads the uploaded invoice and ranks candidates; nothing is stored, so no base-currency lock.
router.post(
  '/match-invoice',
  authenticateSession,
  requireFeature(FEATURES.attachments),
  requireFeatureOrTrial(FEATURES.invoice_matching),
  attachmentUploadRateLimit,
  express.raw({ type: 'application/octet-stream', limit: ATTACHMENT_MAX_FILE_BYTES }),
  validateEndpoint(matchInvoice.schema),
  matchInvoice.handler,
);
router.post(
  '/match-invoice/candidates',
  authenticateSession,
  // No AI and no try spent, so a user whose free tries are gone can still correct the
  // fields of the invoice they just read. Only the attachments gate applies.
  requireFeature(FEATURES.attachments),
  attachmentUploadRateLimit,
  validateEndpoint(rematchInvoice.schema),
  rematchInvoice.handler,
);
router.delete(
  '/refund',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(deleteRefund.schema),
  deleteRefund.handler,
);

router.get(
  '/reconciliation/history',
  authenticateSession,
  validateEndpoint(reconciliation.historyController.schema),
  reconciliation.historyController.handler,
);
router.get(
  '/reconciliation/stuck-pending',
  authenticateSession,
  validateEndpoint(reconciliation.stuckPendingController.schema),
  reconciliation.stuckPendingController.handler,
);
router.post(
  '/reconciliation/remove',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(reconciliation.removeController.schema),
  reconciliation.removeController.handler,
);
router.post(
  '/reconciliation/merge',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(reconciliation.mergeController.schema),
  reconciliation.mergeController.handler,
);
router.post(
  '/reconciliation/restore',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(reconciliation.restoreController.schema),
  reconciliation.restoreController.handler,
);
router.post(
  '/reconciliation/keep-as-booked',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(reconciliation.keepAsBookedController.schema),
  reconciliation.keepAsBookedController.handler,
);
router.post(
  '/reconciliation/stuck-pending/check',
  authenticateSession,
  requireFeature(FEATURES.bank_providers),
  blockDemoUsers,
  checkBaseCurrencyLock,
  validateEndpoint(reconciliation.checkStuckPendingController.schema),
  reconciliation.checkStuckPendingController.handler,
);

// Split routes
router.delete(
  '/splits/:splitId',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(deleteSplit.schema),
  deleteSplit.handler,
);

// Portfolio linking routes
router.post(
  '/:transactionId/link-to-portfolio',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(linkToPortfolio.schema),
  linkToPortfolio.handler,
);
router.post(
  '/:transactionId/unlink-from-portfolio',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(unlinkFromPortfolio.schema),
  unlinkFromPortfolio.handler,
);
router.get(
  '/:transactionId/portfolio-link',
  authenticateSession,
  validateEndpoint(getPortfolioLink.schema),
  getPortfolioLink.handler,
);

// Attachments. Listing stays ungated so a lapsed user can still reach their own files.
router.post(
  '/:transactionId/attachments',
  authenticateSessionOrUploadToken,
  requireFeature(FEATURES.attachments),
  attachmentUploadRateLimit,
  express.raw({ type: 'application/octet-stream', limit: ATTACHMENT_MAX_FILE_BYTES }),
  validateEndpoint(uploadAttachmentController.schema),
  uploadAttachmentController.handler,
);
router.get(
  '/:transactionId/attachments',
  authenticateSession,
  validateEndpoint(listAttachmentsController.schema),
  listAttachmentsController.handler,
);

router.get('/', authenticateSession, validateEndpoint(getTransactions.schema), getTransactions.handler);
router.get('/by-ids', authenticateSession, validateEndpoint(getTransactionsByIds.schema), getTransactionsByIds.handler);
router.get('/:id', authenticateSession, validateEndpoint(getTransactionById.schema), getTransactionById.handler);
router.get(
  '/:id/refunds',
  authenticateSession,
  validateEndpoint(getRefundsForTransactionById.schema),
  getRefundsForTransactionById.handler,
);
router.get(
  '/transfer/:transferId',
  authenticateSession,
  validateEndpoint(getTransactionsByTransferId.schema),
  getTransactionsByTransferId.handler,
);
router.post(
  '/',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(createTransaction.schema),
  createTransaction.handler,
);
router.put(
  '/unlink',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(unlinkTransferTransactions.schema),
  unlinkTransferTransactions.handler,
);
router.put('/link', authenticateSession, checkBaseCurrencyLock, linkTransactions);
router.put(
  '/bulk',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(bulkUpdate.schema),
  bulkUpdate.handler,
);
router.post(
  '/bulk-delete',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(bulkDelete.schema),
  bulkDelete.handler,
);
router.put(
  '/:id',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(updateTransaction.schema),
  updateTransaction.handler,
);
router.delete(
  '/:id',
  authenticateSession,
  checkBaseCurrencyLock,
  validateEndpoint(deleteTransaction.schema),
  deleteTransaction.handler,
);

export default router;
