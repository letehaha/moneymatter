import { csvStatusController } from '@controllers/import-export/csv/csv-status.controller';
import { detectDuplicatesController } from '@controllers/import-export/detect-duplicates.controller';
import { executeImportController } from '@controllers/import-export/execute-import.controller';
import { extractUniqueValuesController } from '@controllers/import-export/extract-unique-values.controller';
import { parseCsv } from '@controllers/import-export/parse-csv.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { csvImportRateLimit } from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router({});

// Parse CSV file and return preview
router.post('/csv/parse', authenticateSession, checkBaseCurrencyLock, csvImportRateLimit, parseCsv);

// Extract unique accounts/categories from full dataset
router.post(
  '/csv/extract-unique-values',
  authenticateSession,
  checkBaseCurrencyLock,
  csvImportRateLimit,
  extractUniqueValuesController,
);

// Validate and detect duplicate transactions
router.post(
  '/csv/detect-duplicates',
  authenticateSession,
  checkBaseCurrencyLock,
  csvImportRateLimit,
  detectDuplicatesController,
);

// Execute the import. Enqueues a background job and returns its id; progress is
// fanned out over SSE (`CSV_IMPORT_PROGRESS`) and pollable via the status route.
router.post('/csv/execute', authenticateSession, checkBaseCurrencyLock, csvImportRateLimit, executeImportController);

// Fallback polling path for an enqueued import. No rate limiter here: the
// frontend polls this every ~2s while an import runs, which the execute-tuned
// `csvImportRateLimit` would quickly reject.
router.get('/csv/execute/status/:jobId', authenticateSession, csvStatusController);

export default router;
