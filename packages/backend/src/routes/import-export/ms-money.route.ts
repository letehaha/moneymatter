import { MS_MONEY_MAX_FILE_BYTES } from '@bt/shared/types';
import { detectMsMoneyDuplicatesController } from '@controllers/import-export/ms-money/detect-ms-money-duplicates.controller';
import { executeMsMoneyController } from '@controllers/import-export/ms-money/execute-ms-money.controller';
import { msMoneyStatusController } from '@controllers/import-export/ms-money/ms-money-status.controller';
import { uploadMsMoneyController } from '@controllers/import-export/ms-money/upload-ms-money.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { csvImportRateLimit, msMoneyUploadRateLimit } from '@middlewares/rate-limit';
import express, { Router } from 'express';

import { MS_MONEY_ROUTE_PATHS } from './ms-money-paths';

const router = Router({});

// A `.mny` file is a binary database, so it arrives as raw bytes and this route
// gets its own body parser — the global JSON parser skips this path entirely.
// The parser sits behind the auth and rate-limit guards so a rejected request is
// answered before up to 50MB is buffered.
router.post(
  MS_MONEY_ROUTE_PATHS.upload,
  authenticateSession,
  checkBaseCurrencyLock,
  msMoneyUploadRateLimit,
  express.raw({ type: 'application/octet-stream', limit: MS_MONEY_MAX_FILE_BYTES }),
  uploadMsMoneyController,
);

// Every step after the upload sends the upload id instead of the file, so these
// bodies are small and share the ordinary import rate limit.
router.post(
  MS_MONEY_ROUTE_PATHS.detectDuplicates,
  authenticateSession,
  checkBaseCurrencyLock,
  csvImportRateLimit,
  detectMsMoneyDuplicatesController,
);

router.post(
  MS_MONEY_ROUTE_PATHS.execute,
  authenticateSession,
  checkBaseCurrencyLock,
  csvImportRateLimit,
  executeMsMoneyController,
);

// No rate limit: the client polls this while an import runs, as the fallback for
// a dropped SSE connection.
router.get(MS_MONEY_ROUTE_PATHS.status, authenticateSession, msMoneyStatusController);

export default router;
