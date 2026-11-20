import { BILLING_PROVIDERS, TERMINAL_SUBSCRIPTION_STATUSES, isTerminalStripeStatus } from '@bt/shared/types';
import { authPool } from '@config/auth';
import { ConflictError } from '@js/errors';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import * as Users from '@models/users.model';
import { getStripeClient } from '@services/billing/stripe/client';
import { Op } from 'sequelize';
import Stripe from 'stripe';

import { runUserDestroyLifecycle } from './user-destroy-lifecycle';

export const deleteUser = async ({ userId }: { userId: number }) => {
  // Cancelling first, and letting a failure abort: a customer whose card is still
  // chargeable must not end up with no account to cancel from. Paused counts too — it
  // can be resumed from Stripe's side. App Store subscriptions cannot be canceled server-side.
  const liveSubscriptions = await BillingSubscriptions.findAll({
    where: { userId, provider: BILLING_PROVIDERS.stripe, status: { [Op.notIn]: TERMINAL_SUBSCRIPTION_STATUSES } },
    attributes: ['externalSubscriptionId'],
  });
  for (const { externalSubscriptionId } of liveSubscriptions) {
    try {
      const stripe = getStripeClient();
      // The mirror can lag Stripe (a cancel on link.com emits no webhook we act on), and
      // cancelling an already-terminal subscription is rejected as an invalid request.
      const remote = await stripe.subscriptions.retrieve(externalSubscriptionId);
      if (isTerminalStripeStatus(remote)) continue;
      await stripe.subscriptions.cancel(externalSubscriptionId);
    } catch (error) {
      if (error instanceof Stripe.errors.StripeInvalidRequestError && error.code === 'resource_missing') {
        logger.info(`Stripe no longer knows subscription ${externalSubscriptionId}; treating it as canceled`);
        continue;
      }
      captureException({ error, context: { userId, externalSubscriptionId } });
      throw new ConflictError({
        message: 'Could not cancel your subscription. Try again, or cancel it from the billing portal first.',
      });
    }
  }

  // Captured inside the in-tx destroy step so the post-tx hook can hit the better-auth
  // pool with the right id. Kept here (not inside the orchestrator) because better-auth
  // is delete-user-specific — wipe-user-data preserves the auth row.
  let capturedAuthUserId: string | null = null;

  await runUserDestroyLifecycle({
    userId,
    stampCreatorSnapshot: true,
    cacheLogPrefix: 'user-deletion',
    failureLogCode: 'USER_DELETE_FAILED',
    failureLogMessage: 'User deletion failed',
    destroyInTx: async ({ user }) => {
      capturedAuthUserId = user.authUserId ?? null;
      await Users.default.destroy({ where: { id: userId } });
    },
    // Drop the better-auth row on its separate pool — must not share the app DB tx, since
    // a transient app-tx rollback would otherwise orphan a live ba_user against a deleted
    // app user. Logged-but-not-rethrown: the app user is already gone by this point.
    postTxBeforeFanOut: async () => {
      if (!capturedAuthUserId) return;
      try {
        await authPool.query('DELETE FROM ba_user WHERE id = $1', [capturedAuthUserId]);
        logger.info(`Deleted better-auth user ${capturedAuthUserId} for app user ${userId}`);
      } catch (authError) {
        logger.error({ message: 'Failed to delete better-auth user', error: authError as Error });
        captureException({ error: authError, context: { userId, authUserId: capturedAuthUserId } });
      }
    },
  });
};
