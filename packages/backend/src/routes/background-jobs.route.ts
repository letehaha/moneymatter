import { getBackgroundJobController } from '@controllers/background-jobs/get-background-job.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { Router } from 'express';

const router = Router();

router.get('/:jobId', authenticateSession, getBackgroundJobController);

export default router;
