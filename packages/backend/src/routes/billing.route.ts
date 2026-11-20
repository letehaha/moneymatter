import { createCheckout, createPortalSession, syncAppleTransaction } from '@controllers/billing.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { cloudOnly } from '@middlewares/cloud-only';
import { billingRateLimit } from '@middlewares/rate-limit';
import { Router } from 'express';

const router = Router();

router.use(cloudOnly);

router.post('/checkout', authenticateSession, blockDemoUsers, billingRateLimit, createCheckout);

router.post('/portal', authenticateSession, blockDemoUsers, billingRateLimit, createPortalSession);

router.post('/apple/transactions', authenticateSession, blockDemoUsers, billingRateLimit, syncAppleTransaction);

export default router;
