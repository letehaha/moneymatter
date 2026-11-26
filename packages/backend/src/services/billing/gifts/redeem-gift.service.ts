import {
  BILLING_CYCLES,
  BILLING_PROVIDERS,
  PLANS,
  type RedeemGiftResponse,
  SUBSCRIPTION_STATUSES,
  isEntitledSubscription,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { ConflictError, NotFoundError, ValidationError } from '@js/errors';
import { invalidateAppUserCache } from '@middlewares/better-auth';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import Gifts from '@models/gifts.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';

import { stopRenewals } from '../lifetime-purchase.service';
import { sendSubscriptionWelcomeEmail } from '../send-subscription-welcome-email';
import { getStripeClient } from '../stripe/client';
import { giftCodeExpiresAt } from './deliver-gifts.service';
import { giftPeriod, latestPaidEnd } from './queue-gifts';

const normalizeGiftCode = ({ code }: { code: string }) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

const assertRedeemable = ({ gift }: { gift: Gifts | null }): Gifts => {
  if (!gift || gift.refundedAt) throw new NotFoundError({ message: t({ key: 'gifts.invalidCode' }) });
  if (gift.redeemedAt) throw new ConflictError({ message: t({ key: 'gifts.alreadyRedeemed' }) });
  if (gift.sentAt && giftCodeExpiresAt({ sentAt: gift.sentAt }).getTime() < Date.now()) {
    throw new ValidationError({ message: t({ key: 'gifts.expired' }) });
  }
  return gift;
};

const grantGift = withTransaction(
  async ({ userId, giftId }: { userId: number; giftId: string }): Promise<BillingSubscriptions> => {
    const gift = assertRedeemable({ gift: await Gifts.findByPk(giftId, { lock: true }) });

    const subscriptions = await BillingSubscriptions.findAll({ where: { userId } });
    // A Stripe failure rolls the grant back, so the user keeps both the code and the renewal.
    if (subscriptions.some((s) => s.provider === BILLING_PROVIDERS.stripe)) {
      await stopRenewals({ userId, stripe: getStripeClient() });
    }

    const now = new Date();
    await gift.update({ redeemedAt: now, redeemedByUserId: userId });
    // A scheduled cancel makes every client read the row as "ends on", never "renews on".
    return BillingSubscriptions.create({
      userId,
      provider: BILLING_PROVIDERS.gift,
      externalSubscriptionId: gift.id,
      externalCustomerId: gift.id,
      status: SUBSCRIPTION_STATUSES.active,
      tier: gift.tier,
      billingCycle: BILLING_CYCLES.year,
      ...giftPeriod({ startsAt: latestPaidEnd({ rows: subscriptions, now }) }),
      providerUpdatedAt: now,
    });
  },
);

/**
 * The grant re-checks the code under a row lock before it stops any Stripe renewal, so a
 * losing concurrent redemption or a code that lapsed meanwhile leaves the renewal running.
 */
export async function redeemGift({ userId, code }: { userId: number; code: string }): Promise<RedeemGiftResponse> {
  const gift = assertRedeemable({ gift: await Gifts.findOne({ where: { code: normalizeGiftCode({ code }) } }) });

  const user = await Users.findByPk(userId, { attributes: ['id', 'plan', 'authUserId'] });
  if (!user) throw new NotFoundError({ message: t({ key: 'gifts.invalidCode' }) });
  // Lifetime Plus covers every gift; lifetime Essential covers an Essential one.
  if (user.plan === PLANS.plus || user.plan === gift.tier) {
    throw new ConflictError({ message: t({ key: 'gifts.coveredByLifetime' }) });
  }

  const subscriptions = await BillingSubscriptions.findAll({ where: { userId } });
  const renewingAppStore = subscriptions.some(
    (s) =>
      s.provider === BILLING_PROVIDERS.apple && isEntitledSubscription(s) && s.scheduledChange?.action !== 'cancel',
  );
  if (renewingAppStore) throw new ConflictError({ message: t({ key: 'gifts.cancelAppStoreFirst' }) });

  const row = await grantGift({ userId, giftId: gift.id });
  if (user.authUserId) await invalidateAppUserCache({ authUserId: user.authUserId });
  await sendSubscriptionWelcomeEmail({ userId, tier: gift.tier });
  return {
    tier: gift.tier,
    currentPeriodStartsAt: row.currentPeriodStartsAt!.toISOString(),
    currentPeriodEndsAt: row.currentPeriodEndsAt.toISOString(),
  };
}
