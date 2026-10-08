import { OFX_MAX_FILE_BYTES } from '@bt/shared/types';
import { detectOfxDuplicatesController } from '@controllers/import-export/ofx/detect-ofx-duplicates.controller';
import { executeOfxController } from '@controllers/import-export/ofx/execute-ofx.controller';
import { ofxStatusController } from '@controllers/import-export/ofx/ofx-status.controller';
import { uploadOfxController } from '@controllers/import-export/ofx/upload-ofx.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { csvImportRateLimit } from '@middlewares/rate-limit';
import express, { Router } from 'express';

import { OFX_ROUTE_PATHS } from './ofx-paths';

const router = Router({});

router.post(
  OFX_ROUTE_PATHS.upload,
  authenticateSession,
  checkBaseCurrencyLock,
  csvImportRateLimit,
  express.raw({ type: 'application/octet-stream', limit: OFX_MAX_FILE_BYTES }),
  uploadOfxController,
);

router.post(
  OFX_ROUTE_PATHS.detectDuplicates,
  authenticateSession,
  checkBaseCurrencyLock,
  csvImportRateLimit,
  detectOfxDuplicatesController,
);

router.post(
  OFX_ROUTE_PATHS.execute,
  authenticateSession,
  checkBaseCurrencyLock,
  csvImportRateLimit,
  executeOfxController,
);

router.get(OFX_ROUTE_PATHS.status, authenticateSession, ofxStatusController);

export default router;
