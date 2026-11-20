import { Type } from '@apple/app-store-server-library';
import {
  API_ERROR_CODES,
  BILLING_PROVIDERS,
  type BillingTier,
  type Entitlements,
  SUBSCRIPTION_STATUSES,
  isEntitledSubscription,
} from '@bt/shared/types';
import { BadRequestError, ConflictError, NotFoundError } from '@js/errors';
import { captureException } from '@js/utils/sentry';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import Users from '@models/users.model';
import { getEntitlementsByUserId } from '@services/entitlements/resolve-entitlements.service';

import { handleBillingWebhook } from '../handle-webhook.service';
import { getAppleSubscriptionState, toAppleEnvironment, verifyAppleTransaction } from './client';
import { resolveAppleOwner } from './resolve-owner';
import { toAppleSubscriptionEvent } from './to-subscription-event';

const ownedByAnotherAccount = () =>
  new ConflictError({
    code: API_ERROR_CODES.subscriptionOwnedByAnotherAccount,
    message: 'This App Store subscription belongs to another MoneyMatter account.',
  });

/** The user paid Apple either way, so the row is kept and the overlap is left for a manual refund. */
const reportOverlappingEntitlement = async ({
  user,
  tier,
  originalTransactionId,
}: {
  user: Pick<Users, 'id' | 'plan'>;
  tier: BillingTier;
  originalTransactionId: string;
}) => {
  const stripeSubscriptions = await BillingSubscriptions.findAll({
    where: { userId: user.id, provider: BILLING_PROVIDERS.stripe },
    attributes: ['externalSubscriptionId', 'status', 'currentPeriodEndsAt'],
  });
  const liveStripeIds = stripeSubscriptions.filter(isEntitledSubscription).map((s) => s.externalSubscriptionId);
  if (!liveStripeIds.length && user.plan !== tier) return;

  captureException({
    error: new Error('App Store purchase overlaps an existing entitlement'),
    context: { userId: user.id, originalTransactionId, liveStripeIds, plan: user.plan },
  });
};

/**
 * iOS posts every transaction it sees (purchase, restore, `Transaction.updates`), so a
 * replay must resolve to the same row and the same entitlements.
 */
export async function syncAppleTransaction({
  userId,
  signedTransaction,
}: {
  userId: number;
  signedTransaction: string;
}): Promise<{ entitlements: Entitlements }> {
  const transaction = await verifyAppleTransaction({ signedTransaction });
  const { originalTransactionId } = transaction;
  if (!originalTransactionId || transaction.type !== Type.AUTO_RENEWABLE_SUBSCRIPTION) {
    throw new BadRequestError({ message: 'Not an App Store subscription.' });
  }

  const state = await getAppleSubscriptionState({
    originalTransactionId,
    environment: toAppleEnvironment({ environment: transaction.environment }),
  });
  const { owner, mirroredForUserId } = await resolveAppleOwner({
    originalTransactionId,
    appAccountToken: state.transaction.appAccountToken,
  });
  // No token (bought outside our purchase call) or a deleted account's token binds to the caller.
  if (owner && owner !== 'deleted' && owner.userId !== userId) throw ownedByAnotherAccount();

  const user = await Users.findByPk(userId, { attributes: ['id', 'plan', 'appStoreAccountToken'] });
  if (!user) throw new NotFoundError({ message: 'User not found.' });

  const event = toAppleSubscriptionEvent({
    state,
    eventId: null,
    userId,
    externalCustomerId: user.appStoreAccountToken,
  });
  if (mirroredForUserId !== userId && event.status !== SUBSCRIPTION_STATUSES.canceled) {
    await reportOverlappingEntitlement({ user, tier: event.tier, originalTransactionId });
  }
  await handleBillingWebhook({ event });

  return { entitlements: await getEntitlementsByUserId({ userId }) };
}
