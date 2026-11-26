import {
  BILLING_CYCLES,
  BILLING_TIERS,
  GIFT_MAX_DELIVERY_DAYS,
  GIFT_MESSAGE_MAX_LENGTH,
  GIFT_NAME_MAX_LENGTH,
} from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { syncAppleTransaction as syncAppleTransactionService } from '@services/billing/apple/sync-transaction.service';
import { createCheckoutSession } from '@services/billing/checkout.service';
import { createGiftCheckout as createGiftCheckoutService } from '@services/billing/gifts/create-gift-checkout.service';
import { redeemGift as redeemGiftService } from '@services/billing/gifts/redeem-gift.service';
import { getPortalUrl } from '@services/billing/portal.service';
import { addDays } from 'date-fns';
import { z } from 'zod';

export const createCheckout = createController(
  z.object({ body: z.object({ tier: z.enum(BILLING_TIERS), cycle: z.enum(BILLING_CYCLES) }) }),
  async ({ user, body }) => {
    const data = await createCheckoutSession({
      userId: user.id,
      plan: user.plan ?? null,
      tier: body.tier,
      cycle: body.cycle,
    });
    return { data };
  },
);

export const createPortalSession = createController(
  z.object({ body: z.object({ flow: z.literal('subscription_update').optional() }) }),
  async ({ user, body }) => {
    const data = await getPortalUrl({ userId: user.id, flow: body.flow });
    return { data };
  },
);

export const syncAppleTransaction = createController(
  z.object({ body: z.object({ signedTransaction: z.string().min(1).max(20_000) }) }),
  async ({ user, body }) => {
    const data = await syncAppleTransactionService({ userId: user.id, signedTransaction: body.signedTransaction });
    return { data };
  },
);

const giftName = z.string().trim().min(1).max(GIFT_NAME_MAX_LENGTH);
const giftEmail = z.string().trim().email().max(320);

export const createGiftCheckoutSchema = z.object({
  body: z.object({
    tier: z.enum(BILLING_TIERS),
    buyerName: giftName,
    buyerEmail: giftEmail,
    recipientName: giftName,
    recipientEmail: giftEmail,
    message: z.string().trim().max(GIFT_MESSAGE_MAX_LENGTH).optional(),
    deliverAt: z
      .string()
      .datetime({ offset: true })
      .refine((value) => new Date(value) <= addDays(new Date(), GIFT_MAX_DELIVERY_DAYS), {
        message: `Delivery can be scheduled up to ${GIFT_MAX_DELIVERY_DAYS} days ahead`,
      })
      .optional(),
    returnPath: z
      .string()
      .regex(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?gift$/)
      .optional(),
  }),
});

export const createGiftCheckout = createController(createGiftCheckoutSchema, async ({ body }) => {
  const data = await createGiftCheckoutService({ body });
  return { data };
});

export const redeemGift = createController(
  z.object({ body: z.object({ code: z.string().trim().min(1).max(64) }) }),
  async ({ user, body }) => {
    const data = await redeemGiftService({ userId: user.id, code: body.code });
    return { data };
  },
);
