import {
  estimateCostController as importEstimateCostController,
  executeImportController as importExecuteController,
  extractController as importExtractController,
} from '@controllers/investment-transactions-parser';
import {
  createHoldingController,
  deleteHoldingController,
  getHoldingsController,
} from '@controllers/investments/holdings';
import accountToPortfolioTransferController from '@controllers/investments/portfolios/account-to-portfolio-transfer';
import createPortfolioController from '@controllers/investments/portfolios/create-portfolio';
import createPortfolioTransferController from '@controllers/investments/portfolios/create-portfolio-transfer';
import deletePortfolioController from '@controllers/investments/portfolios/delete-portfolio';
import deletePortfolioTransferController from '@controllers/investments/portfolios/delete-portfolio-transfer';
import directCashTransactionController from '@controllers/investments/portfolios/direct-cash-transaction';
import exchangeCurrencyController from '@controllers/investments/portfolios/exchange-currency';
import getPortfolioController from '@controllers/investments/portfolios/get-portfolio';
import getPortfolioBalanceController from '@controllers/investments/portfolios/get-portfolio-balance';
import getPortfolioSummariesController from '@controllers/investments/portfolios/get-portfolio-summaries.controller';
import getPortfolioSummaryController from '@controllers/investments/portfolios/get-portfolio-summary.controller';
import getPortfoliosAnnualizedReturnsController from '@controllers/investments/portfolios/get-portfolios-annualized-returns.controller';
import listPortfolioTransfersController from '@controllers/investments/portfolios/list-portfolio-transfers';
import listPortfoliosController from '@controllers/investments/portfolios/list-portfolios';
import portfolioToAccountTransferController from '@controllers/investments/portfolios/portfolio-to-account-transfer';
import restorePortfolioController from '@controllers/investments/portfolios/restore-portfolio';
import setTransferAdjustmentController from '@controllers/investments/portfolios/set-transfer-adjustment';
import updatePortfolioController from '@controllers/investments/portfolios/update-portfolio';
import updatePortfolioBalanceController from '@controllers/investments/portfolios/update-portfolio-balance';
import getPricesController from '@controllers/investments/prices/get-prices.controller';
import securitiesSyncController from '@controllers/investments/prices/securities-sync.controller';
import bulkUploadPricesController from '@controllers/investments/securities/bulk-upload-prices.controller';
import getAllSecurities from '@controllers/investments/securities/get-all.controller';
import getPriceUploadInfoController from '@controllers/investments/securities/get-price-upload-info.controller';
import searchSecuritiesController from '@controllers/investments/securities/search.controller';
import createInvestmentTransactionController from '@controllers/investments/transactions/create-tx.controller';
import deleteInvestmentTransactionController from '@controllers/investments/transactions/delete-tx.controller';
import getTransactionsController from '@controllers/investments/transactions/get-transactions.controller';
import updateInvestmentTransactionController from '@controllers/investments/transactions/update-tx.controller';
import { adminOnly } from '@middlewares/admin-only';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { priceSyncRateLimit, securitiesPricesBulkUploadRateLimit } from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router({});

// Demo users get a pre-seeded portfolio and can edit it freely. Creating new
// portfolios and deleting existing ones are blocked per-route below; admin-only
// endpoints enforce their own access checks.
router.use(authenticateSession);

// Portfolio routes
router.get('/portfolios', listPortfoliosController);

// Static paths — must be registered before `/portfolios/:id` so they aren't
// swallowed as `:id = "annualized-returns"` / `:id = "summaries"`.
router.get('/portfolios/annualized-returns', getPortfoliosAnnualizedReturnsController);

router.get('/portfolios/summaries', getPortfolioSummariesController);

router.get('/portfolios/:id', getPortfolioController);

router.get('/portfolios/:id/balance', getPortfolioBalanceController);

router.get('/portfolios/:id/summary', getPortfolioSummaryController);

// Test-only cash seeding: writes `PortfolioBalances` directly, bypassing the
// InvestmentTransaction/PortfolioTransfers audit trail. Production cash moves
// through transfers and cash-transactions instead, so this stays off there.
// "development" is required: Playwright frontend e2e run against the dev backend.
// ENABLE_TEST_SEEDING_ENDPOINTS covers the preview environment: it runs with
// NODE_ENV=production yet hosts the Playwright e2e suite that seeds via this route.
if (
  process.env.NODE_ENV === 'test' ||
  process.env.NODE_ENV === 'development' ||
  process.env.ENABLE_TEST_SEEDING_ENDPOINTS === 'true'
) {
  router.put('/portfolios/:id/balance', checkBaseCurrencyLock, updatePortfolioBalanceController);
}

router.post('/portfolios/:id/cash-transaction', checkBaseCurrencyLock, directCashTransactionController);

router.post('/portfolios/:id/transfer', checkBaseCurrencyLock, createPortfolioTransferController);

router.post('/portfolios/:id/exchange-currency', checkBaseCurrencyLock, exchangeCurrencyController);

router.post('/portfolios/:id/transfer/from-account', checkBaseCurrencyLock, accountToPortfolioTransferController);

router.post('/portfolios/:id/transfer/to-account', checkBaseCurrencyLock, portfolioToAccountTransferController);

router.get('/portfolios/:id/transfers', listPortfolioTransfersController);

router.patch(
  '/portfolios/:id/transfers/:transferId/adjustment',
  checkBaseCurrencyLock,
  setTransferAdjustmentController,
);

router.delete('/portfolios/:id/transfers/:transferId', checkBaseCurrencyLock, deletePortfolioTransferController);

router.put('/portfolios/:id', checkBaseCurrencyLock, updatePortfolioController);

router.delete('/portfolios/:id', blockDemoUsers, checkBaseCurrencyLock, deletePortfolioController);

router.post('/portfolios/:id/restore', blockDemoUsers, checkBaseCurrencyLock, restorePortfolioController);

router.post('/portfolios', blockDemoUsers, checkBaseCurrencyLock, createPortfolioController);

router.post('/sync/securities-prices', adminOnly, priceSyncRateLimit, securitiesSyncController);

router.get('/prices', getPricesController);
router.get('/securities', getAllSecurities);

router.get('/securities/search', searchSecuritiesController);

// Admin-only: Get price upload info (accepts currency code)
router.post('/securities/price-upload-info', adminOnly, getPriceUploadInfoController);

// Admin-only: Bulk upload security prices (accepts SecuritySearchResult)
// Note: 1mb limit is set in app.ts for this path
router.post(
  '/securities/prices/bulk-upload',
  adminOnly,
  securitiesPricesBulkUploadRateLimit,
  bulkUploadPricesController,
);

router.get('/portfolios/:portfolioId/holdings', getHoldingsController);
router.post('/holding', checkBaseCurrencyLock, createHoldingController);
router.delete('/holding', checkBaseCurrencyLock, deleteHoldingController);

router.get('/transactions', getTransactionsController);

router.post('/transaction', checkBaseCurrencyLock, createInvestmentTransactionController);

router.delete('/transaction/:transactionId', checkBaseCurrencyLock, deleteInvestmentTransactionController);

router.put('/transaction/:transactionId', checkBaseCurrencyLock, updateInvestmentTransactionController);

/**
 * Investment transactions import. Two paths share the review + execute stages:
 *   - AI:  estimate-cost → extract({ source: 'ai' }) → execute
 *   - CSV: (frontend parses locally via papaparse) → extract({ source: 'csv', columnMapping }) → execute
 *
 * `extract` is the merged endpoint; the body's discriminator decides whether
 * the file is fed through the AI provider or parsed via the codebase CSV
 * parser using a user-supplied column mapping.
 */
router.post('/transactions-import/estimate-cost', checkBaseCurrencyLock, importEstimateCostController);
router.post('/transactions-import/extract', checkBaseCurrencyLock, importExtractController);
router.post('/transactions-import/execute', checkBaseCurrencyLock, importExecuteController);

export default router;
