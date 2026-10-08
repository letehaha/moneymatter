import { executeYnabController } from '@controllers/import-export/ynab/execute-ynab.controller';
import { parseYnabController } from '@controllers/import-export/ynab/parse-ynab.controller';
import { ynabStatusController } from '@controllers/import-export/ynab/ynab-status.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { checkBaseCurrencyLock } from '@middlewares/check-base-currency-lock';
import { csvImportRateLimit } from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router({});

router.post('/ynab/parse', authenticateSession, checkBaseCurrencyLock, csvImportRateLimit, parseYnabController);

router.post('/ynab/execute', authenticateSession, checkBaseCurrencyLock, csvImportRateLimit, executeYnabController);

router.get('/ynab/status/:jobId', authenticateSession, ynabStatusController);

export default router;
