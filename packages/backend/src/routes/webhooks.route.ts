import { handleAppleWebhook, handleBillingWebhook, handleGitHubWebhook } from '@controllers/webhooks.controller';
import { cloudOnly } from '@middlewares/cloud-only';
import { verifyGitHubWebhook } from '@middlewares/github-webhook';
import { billingWebhookRateLimit } from '@middlewares/rate-limit';
import { verifyStripeWebhook } from '@middlewares/stripe-webhook';
import { Router } from 'express';

const router = Router({});

/**
 * GitHub webhook endpoint for release notifications.
 * No authentication required - uses signature verification instead.
 *
 * Configure in GitHub:
 * 1. Go to repo Settings > Webhooks > Add webhook
 * 2. Payload URL: https://your-domain.com/api/v1/webhooks/github
 * 3. Content type: application/json
 * 4. Secret: same as GITHUB_WEBHOOK_SECRET env var
 * 5. Events: Select "Releases" only
 */
router.post('/github', verifyGitHubWebhook, handleGitHubWebhook);

router.post('/billing', cloudOnly, billingWebhookRateLimit, verifyStripeWebhook, handleBillingWebhook);

/** App Store Server Notifications V2. Set as both the Production and Sandbox URL in App Store Connect. */
router.post('/apple', cloudOnly, billingWebhookRateLimit, handleAppleWebhook);

export default router;
