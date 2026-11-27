import { BILLING_PROVIDERS, SUBSCRIPTION_STATUSES, parseBillingTier } from '@bt/shared/types';
import { logger } from '@js/utils/logger';
import { captureException } from '@js/utils/sentry';
import { invalidateAppUserCache } from '@middlewares/better-auth';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import Gifts from '@models/gifts.model';
import Users from '@models/users.model';
import { withTransaction } from '@services/common/with-transaction';
import crypto from 'crypto';
import type Stripe from 'stripe';

import { idOf } from '../stripe/client';
import { GIFT_METADATA } from './create-gift-checkout.service';
import { deliverGift, sendGiftBuyerConfirmation } from './deliver-gifts.service';
import { requeueGifts } from './queue-gifts';

/** No 0/O or 1/I/L, so a code read off a screen or paper types back unambiguously. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 12;

const generateGiftCode = (): string =>
  Array.from(crypto.randomBytes(CODE_LENGTH), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');

export const isGiftCheckoutSession = ({ session }: { session: Stripe.Checkout.Session }): boolean =>
  Boolean(session.metadata?.[GIFT_METADATA.tier]);

type GiftFields = Pick<
  Gifts,
  | 'tier'
  | 'buyerName'
  | 'buyerEmail'
  | 'recipientName'
  | 'recipientEmail'
  | 'message'
  | 'deliverAt'
  | 'stripeCheckoutSessionId'
  | 'stripePaymentIntentId'
>;

/** Null when the session already bought a gift: both completion events of one checkout land here. */
const createGift = async ({ fields }: { fields: GiftFields }): Promise<Gifts | null> => {
  const [gift, created] = await Gifts.findOrCreate({
    where: { stripeCheckoutSessionId: fields.stripeCheckoutSessionId },
    defaults: { ...fields, code: generateGiftCode() },
  });
  return created ? gift : null;
};

type GiftPurchaseOutcome = 'created' | 'duplicate' | 'ignored';

export async function handleGiftPurchase({
  event,
}: {
  event: Stripe.CheckoutSessionCompletedEvent | Stripe.CheckoutSessionAsyncPaymentSucceededEvent;
}): Promise<GiftPurchaseOutcome> {
  const session = event.data.object;
  // A 100%-off promotion code completes the checkout as `no_payment_required`.
  if (session.mode !== 'payment' || !['paid', 'no_payment_required'].includes(session.payment_status)) {
    return 'ignored';
  }

  const metadata = session.metadata ?? {};
  const tier = parseBillingTier({ value: metadata[GIFT_METADATA.tier] });
  const buyerEmail = session.customer_details?.email ?? session.customer_email;
  const recipientEmail = metadata[GIFT_METADATA.recipientEmail];
  if (!tier || !buyerEmail || !recipientEmail) {
    captureException({
      error: new Error('Paid gift checkout is missing its tier or an email'),
      context: { eventId: event.id, sessionId: session.id },
    });
    return 'ignored';
  }

  const paymentIntentId = idOf({ ref: session.payment_intent });
  if (session.payment_status === 'paid' && !paymentIntentId) {
    captureException({
      error: new Error('Gift purchase has no PaymentIntent, so a refund cannot revoke it'),
      context: { eventId: event.id, sessionId: session.id },
    });
  }

  const deliverAt = metadata[GIFT_METADATA.deliverAt];
  const gift = await createGift({
    fields: {
      tier,
      buyerName: metadata[GIFT_METADATA.buyerName] ?? '',
      buyerEmail,
      recipientName: metadata[GIFT_METADATA.recipientName] ?? '',
      recipientEmail,
      message: metadata[GIFT_METADATA.message] || null,
      deliverAt: deliverAt ? new Date(deliverAt) : new Date(),
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: paymentIntentId,
    },
  });
  if (!gift) return 'duplicate';

  await deliverGift({ giftId: gift.id });
  await sendGiftBuyerConfirmation({ gift });
  return 'created';
}

const revokeGiftImpl = withTransaction(
  async ({ paymentIntentId }: { paymentIntentId: string }): Promise<{ gift: Gifts | null }> => {
    const gift = await Gifts.findOne({ where: { stripePaymentIntentId: paymentIntentId }, lock: true });
    if (!gift || gift.refundedAt) return { gift };

    await gift.update({ refundedAt: new Date() });
    if (gift.redeemedByUserId) {
      await BillingSubscriptions.update(
        { status: SUBSCRIPTION_STATUSES.canceled, scheduledChange: null, providerUpdatedAt: new Date() },
        { where: { provider: BILLING_PROVIDERS.gift, externalSubscriptionId: gift.id } },
      );
      await requeueGifts({ userId: gift.redeemedByUserId });
    }
    return { gift };
  },
);

/**
 * A lost gift payment voids an unredeemed code, and ends the access of a redeemed one.
 * False when the payment bought no gift.
 */
export async function revokeGift({ paymentIntentId }: { paymentIntentId: string }): Promise<boolean> {
  const { gift } = await revokeGiftImpl({ paymentIntentId });
  if (!gift) return false;
  if (gift.redeemedByUserId) {
    const user = await Users.findByPk(gift.redeemedByUserId, { attributes: ['authUserId'] });
    if (user?.authUserId) await invalidateAppUserCache({ authUserId: user.authUserId });
  }
  logger.info(`Gift ${gift.id} revoked after losing ${paymentIntentId}`);
  return true;
}
