import { recordClientLogController } from '@controllers/client-logs/record-client-log.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { clientLogRateLimit } from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router({});

router.post('/', authenticateSession, clientLogRateLimit, recordClientLogController);

export default router;
