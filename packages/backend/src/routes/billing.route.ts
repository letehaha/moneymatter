import {
  createCheckout,
  createGiftCheckout,
  createGiftCheckoutSchema,
  createPortalSession,
  redeemGift,
  syncAppleTransaction,
} from '@controllers/billing.controller';
import { authenticateSession } from '@middlewares/better-auth';
import { blockDemoUsers } from '@middlewares/block-demo-users';
import { cloudOnly } from '@middlewares/cloud-only';
import { billingRateLimit, giftCheckoutIpRateLimit } from '@middlewares/rate-limit';
import { validateEndpoint } from '@middlewares/validations';
import { Router } from 'express';

const router = Router();

router.use(cloudOnly);

router.post('/checkout', authenticateSession, blockDemoUsers, billingRateLimit, createCheckout);

router.post('/portal', authenticateSession, blockDemoUsers, billingRateLimit, createPortalSession);

router.post('/apple/transactions', authenticateSession, blockDemoUsers, billingRateLimit, syncAppleTransaction);

// Public: the buyer needs no account. Validation runs first so a rejected body doesn't burn the visitor's budget.
router.post('/gifts/checkout', validateEndpoint(createGiftCheckoutSchema), giftCheckoutIpRateLimit, createGiftCheckout);

router.post('/gifts/redeem', authenticateSession, blockDemoUsers, billingRateLimit, redeemGift);

export default router;
