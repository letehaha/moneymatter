import { BILLING_CYCLES, type CreateGiftCheckoutBody, STRIPE_PRICE_IDS } from '@bt/shared/types';
import { FRONTEND_BASE_URL } from '@root/config';

import { getStripeClient, getStripeEnv, idOf } from '../stripe/client';

export const GIFT_METADATA = {
  tier: 'gift_tier',
  buyerName: 'gift_buyer_name',
  recipientName: 'gift_recipient_name',
  recipientEmail: 'gift_recipient_email',
  message: 'gift_message',
  deliverAt: 'gift_deliver_at',
} as const;

/**
 * Charges the tier's current yearly price once, on the same Stripe product, so a price
 * change or a promotion code limited to that product reaches gifts without extra setup.
 */
export async function createGiftCheckout({ body }: { body: CreateGiftCheckoutBody }): Promise<{ url: string }> {
  const stripe = getStripeClient();
  const yearly = await stripe.prices.retrieve(STRIPE_PRICE_IDS[getStripeEnv()][body.tier][BILLING_CYCLES.year]);
  if (yearly.unit_amount === null) throw new Error(`Stripe price ${yearly.id} has no unit amount`);

  const giftPageUrl = `${FRONTEND_BASE_URL}${body.returnPath ?? '/gift'}`;

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: yearly.currency,
          unit_amount: yearly.unit_amount,
          product: idOf({ ref: yearly.product })!,
          ...(yearly.tax_behavior && yearly.tax_behavior !== 'unspecified' && { tax_behavior: yearly.tax_behavior }),
        },
        quantity: 1,
      },
    ],
    managed_payments: { enabled: true },
    customer_email: body.buyerEmail,
    allow_promotion_codes: true,
    metadata: {
      [GIFT_METADATA.tier]: body.tier,
      [GIFT_METADATA.buyerName]: body.buyerName,
      [GIFT_METADATA.recipientName]: body.recipientName,
      [GIFT_METADATA.recipientEmail]: body.recipientEmail,
      [GIFT_METADATA.message]: body.message ?? '',
      [GIFT_METADATA.deliverAt]: body.deliverAt ?? '',
    },
    success_url: `${giftPageUrl}?status=success`,
    cancel_url: giftPageUrl,
  });

  if (!session.url) throw new Error(`Stripe checkout session ${session.id} has no url`);
  return { url: session.url };
}
