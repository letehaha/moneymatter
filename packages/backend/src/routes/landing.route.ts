import landingFaqController, { landingFaqSchema } from '@controllers/landing-faq.controller';
import { landingFaqGlobalRateLimit, landingFaqIpRateLimit } from '@middlewares/rate-limit';
import { validateEndpoint } from '@middlewares/validations';
import { Router } from 'express';

const router = Router({});

// Public endpoint - no authentication required. Validation runs first so a rejected
// body doesn't burn the visitor's budget.
router.post(
  '/faq/ask',
  validateEndpoint(landingFaqSchema),
  landingFaqIpRateLimit,
  landingFaqGlobalRateLimit,
  landingFaqController,
);

export default router;
