import { BadRequestError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import { handleAppleNotification } from '@services/billing/apple/handle-notification.service';
import { handleBillingRefund, isRefundEvent } from '@services/billing/handle-refund.service';
import { handleBillingWebhook as handleBillingWebhookService } from '@services/billing/handle-webhook.service';
import {
  isIncompleteSubscriptionEvent,
  isSubscriptionEvent,
  parseStripeWebhook,
} from '@services/billing/stripe/parse-webhook';
import { createReleaseNotifications } from '@services/notifications/release-notifications';
import { Request, Response } from 'express';

/**
 * GitHub release webhook payload structure (subset of fields we care about)
 * @see https://docs.github.com/en/webhooks/webhook-events-and-payloads#release
 */
interface GitHubReleaseWebhookPayload {
  action: 'published' | 'unpublished' | 'created' | 'edited' | 'deleted' | 'prereleased' | 'released';
  release: {
    tag_name: string;
    name: string | null;
    body: string | null;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
    published_at: string | null;
    created_at: string;
  };
  repository: {
    full_name: string;
  };
}

const SKIP_NOTIFICATION_PREFIX = '[chore]';

/**
 * Handles GitHub release webhook events.
 * Creates notifications for users when a new release is published.
 */
async function handleGitHubRelease(req: Request, res: Response): Promise<void> {
  const event = req.headers['x-github-event'] as string;

  // Only handle release events
  if (event !== 'release') {
    logger.info(`Ignoring GitHub webhook event: ${event}`);
    res.status(200).json({ message: 'Event ignored' });
    return;
  }

  const payload = req.body as unknown as GitHubReleaseWebhookPayload;

  // Only notify on 'published' action (not draft, not pre-release)
  if (payload.action !== 'published') {
    logger.info(`Ignoring release action: ${payload.action}`);
    res.status(200).json({ message: 'Action ignored' });
    return;
  }

  // Skip drafts and pre-releases
  if (payload.release.draft || payload.release.prerelease) {
    logger.info('Ignoring draft or pre-release');
    res.status(200).json({ message: 'Draft/prerelease ignored' });
    return;
  }

  const releaseName = payload.release.name || payload.release.tag_name;

  // Skip releases with [chore] prefix
  if (releaseName.toLowerCase().startsWith(SKIP_NOTIFICATION_PREFIX)) {
    logger.info(`Skipping notification for chore release: ${releaseName}`);
    res.status(200).json({ message: 'Chore release skipped' });
    return;
  }

  try {
    const notifiedCount = await createReleaseNotifications({
      version: payload.release.tag_name,
      releaseName,
      releaseUrl: payload.release.html_url,
      releaseDate: payload.release.published_at || payload.release.created_at,
    });

    logger.info(`GitHub release webhook processed: ${payload.release.tag_name}, notified ${notifiedCount} users`);

    res.status(200).json({
      message: 'Release notification created',
      version: payload.release.tag_name,
      notifiedUsers: notifiedCount,
    });
  } catch (error) {
    logger.error({ message: 'Failed to process GitHub release webhook', error: error as Error });
    res.status(500).json({ error: 'Failed to process webhook' });
  }
}

/**
 * Main GitHub webhook handler. Handles ping and release events.
 */
export async function handleGitHubWebhook(req: Request, res: Response): Promise<void> {
  const event = req.headers['x-github-event'] as string;

  // Handle ping event (sent when webhook is first configured)
  if (event === 'ping') {
    logger.info('GitHub webhook ping received');
    res.status(200).json({ message: 'pong' });
    return;
  }

  // For release events, delegate to release handler
  await handleGitHubRelease(req, res);
}

/**
 * Stripe billing webhook. A 500 makes Stripe retry, so a mapping or configuration
 * problem fixed afterwards still lands instead of being silently acknowledged.
 */
export async function handleBillingWebhook(req: Request, res: Response): Promise<void> {
  try {
    const stripeEvent = req.stripeEvent!;
    if (isRefundEvent(stripeEvent)) {
      const outcome = await handleBillingRefund({ event: stripeEvent });
      logger.info(`Billing webhook ${stripeEvent.type} ${stripeEvent.id}: ${outcome}`);
      res.status(200).json({ outcome });
      return;
    }
    if (!isSubscriptionEvent(stripeEvent) || isIncompleteSubscriptionEvent(stripeEvent)) {
      res.status(200).json({ outcome: 'ignored' });
      return;
    }

    const event = parseStripeWebhook({ event: stripeEvent });
    const outcome = await handleBillingWebhookService({ event });
    logger.info(`Billing webhook ${event.eventType} ${event.eventId}: ${outcome}`);
    res.status(200).json({ outcome });
  } catch (error) {
    logger.error({
      message: 'Billing webhook failed',
      error: error as Error,
    });
    captureException({
      error,
      context: { stage: 'handleBillingWebhook', eventId: req.stripeEvent?.id },
    });
    res.status(500).json({ outcome: 'failed' });
  }
}

/**
 * App Store Server Notifications V2. Apple retries anything but a 2xx, so a mapping or
 * configuration failure answers 500 and lands once fixed. A forged body answers 400.
 */
export async function handleAppleWebhook(req: Request, res: Response): Promise<void> {
  const signedPayload = (req.body as { signedPayload?: unknown } | undefined)?.signedPayload;
  if (typeof signedPayload !== 'string' || !signedPayload) {
    res.status(400).json({ error: 'Missing signedPayload' });
    return;
  }

  try {
    const outcome = await handleAppleNotification({ signedPayload });
    logger.info(`App Store notification: ${outcome}`);
    res.status(200).json({ outcome });
  } catch (error) {
    if (error instanceof BadRequestError) {
      logger.warn(`App Store notification rejected: ${error.message}`);
      res.status(400).json({ error: error.message });
      return;
    }
    logger.error({ message: 'App Store notification failed', error: error as Error });
    res.status(500).json({ outcome: 'failed' });
  }
}
