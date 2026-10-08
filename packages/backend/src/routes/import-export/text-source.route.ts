import {
  detectDuplicatesController,
  estimateCostController,
  executeImportController,
  extractController,
  importStatusController,
} from '@controllers/statement-parser';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { Router } from 'express';

const router = Router({});

/**
 * Estimate the cost of extracting transactions from a statement file
 * POST /import/text-source/estimate-cost
 *
 * Supports PDF, CSV, and TXT files
 * Body: { fileBase64: string, password?: string }
 * Returns: StatementCostEstimate
 */
router.post('/text-source/estimate-cost', authenticateSession, checkBaseCurrencyLock, estimateCostController);

/**
 * Extract transactions from a statement file using AI
 * POST /import/text-source/extract
 *
 * Supports PDF, CSV, and TXT files
 * Body: { fileBase64: string, password?: string }
 * Returns: StatementExtractionResult
 */
router.post('/text-source/extract', authenticateSession, checkBaseCurrencyLock, extractController);

/**
 * Detect duplicate transactions for statement import
 * POST /import/text-source/detect-duplicates
 *
 * Compares extracted transactions against existing transactions in an account
 * Body: { accountId: number, transactions: ExtractedTransaction[] }
 * Returns: StatementDetectDuplicatesResponse
 */
router.post('/text-source/detect-duplicates', authenticateSession, checkBaseCurrencyLock, detectDuplicatesController);

/**
 * Execute statement import - create transactions in the database
 * POST /import/text-source/execute
 *
 * Enqueues the import as a background job
 * Body: StatementExecuteImportRequest
 * Returns: StatementExecuteImportQueuedResponse
 */
router.post('/text-source/execute', authenticateSession, checkBaseCurrencyLock, executeImportController);

/**
 * Status of a statement import job
 * GET /import/text-source/execute/status/:jobId
 *
 * Returns: StatementImportProgress
 */
router.get('/text-source/execute/status/:jobId', authenticateSession, importStatusController);

export default router;
