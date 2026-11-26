import { BILLING_PROVIDERS, FEATURES, PLANS, STRIPE_PRICE_IDS } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { giftDeliveryCron } from '@root/crons/gift-delivery';
import * as sendEmailModule from '@services/email/send-email';
import * as helpers from '@tests/helpers';
import { addMonths } from 'date-fns';
import { HttpResponse, http } from 'msw';

const RECIPIENT = 'sam@example.com';
const DAY_MS = 24 * 60 * 60 * 1000;

const getUser = () => helpers.getUserInfo({ raw: true });

const mockStripe = () => {
  const calls = { prices: [] as string[], sessions: [] as URLSearchParams[], renewalsStopped: [] as string[] };
  global.mswMockServer.use(
    http.get('https://api.stripe.com/v1/prices/:id', ({ params }) => {
      calls.prices.push(String(params.id));
      return HttpResponse.json({
        id: params.id,
        object: 'price',
        unit_amount: 5500,
        currency: 'usd',
        product: 'prod_plus',
        tax_behavior: 'exclusive',
      });
    }),
    http.post('https://api.stripe.com/v1/checkout/sessions', async ({ request }) => {
      calls.sessions.push(new URLSearchParams(await request.text()));
      return HttpResponse.json({
        id: 'cs_new',
        object: 'checkout.session',
        url: 'https://checkout.stripe.com/c/cs_new',
      });
    }),
    http.post('https://api.stripe.com/v1/subscriptions/:id', async ({ params, request }) => {
      if (new URLSearchParams(await request.text()).get('cancel_at_period_end') === 'true') {
        calls.renewalsStopped.push(String(params.id));
      }
      return HttpResponse.json({ id: params.id, object: 'subscription', status: 'active' });
    }),
  );
  return calls;
};

const buyGift = async (options: Parameters<typeof helpers.buildStripeGiftCheckoutEvent>[0] = {}) => {
  const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeGiftCheckoutEvent(options) });
  expect(res.statusCode).toBe(200);
  return res.body.outcome as string;
};

describe('Gift subscriptions', () => {
  let sendSpy: jest.SpiedFunction<typeof sendEmailModule.sendEmail>;

  /** The code only reaches the recipient by email, so tests read it from there. */
  const emailedCodes = () =>
    sendSpy.mock.calls
      .filter(([payload]) => payload.to === RECIPIENT)
      .map(([payload]) => payload.html.match(/gift=([A-Z0-9-]+)/)![1]!);

  const buyAndReceive = async (options: Parameters<typeof helpers.buildStripeGiftCheckoutEvent>[0] = {}) => {
    await buyGift(options);
    return emailedCodes().at(-1)!;
  };

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    sendSpy = jest.spyOn(sendEmailModule, 'sendEmail').mockResolvedValue(null);
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    sendSpy.mockRestore();
  });

  describe('POST /billing/gifts/checkout', () => {
    it('opens a one-time checkout at the yearly price of the same product', async () => {
      const calls = mockStripe();

      const res = await helpers.createGiftCheckout({
        payload: {
          tier: 'plus',
          buyerName: 'Alex',
          buyerEmail: 'buyer@example.com',
          recipientName: 'Sam',
          recipientEmail: RECIPIENT,
          message: 'Happy birthday',
          returnPath: '/uk/gift',
        },
        raw: false,
      });

      expect(res.statusCode).toBe(200);
      expect(helpers.extractResponse(res).url).toBe('https://checkout.stripe.com/c/cs_new');
      expect(calls.prices).toEqual([STRIPE_PRICE_IDS.test.plus.year]);
      const form = calls.sessions[0]!;
      expect(form.get('success_url')).toMatch(/\/uk\/gift\?status=success$/);
      expect(form.get('cancel_url')).toMatch(/\/uk\/gift$/);
      expect(form.get('mode')).toBe('payment');
      expect(form.get('line_items[0][price_data][unit_amount]')).toBe('5500');
      expect(form.get('line_items[0][price_data][product]')).toBe('prod_plus');
      expect(form.get('allow_promotion_codes')).toBe('true');
      expect(form.get('metadata[gift_tier]')).toBe('plus');
      expect(form.get('metadata[gift_recipient_email]')).toBe(RECIPIENT);
      expect(form.get('metadata[gift_message]')).toBe('Happy birthday');
    });

    it('rejects a delivery date more than a year ahead, an invalid email and a foreign return path', async () => {
      const calls = mockStripe();
      const base = { tier: 'plus', buyerName: 'Alex', buyerEmail: 'buyer@example.com', recipientName: 'Sam' };

      const tooLate = await helpers.createGiftCheckout({
        payload: {
          ...base,
          recipientEmail: RECIPIENT,
          deliverAt: new Date(Date.now() + 400 * DAY_MS).toISOString(),
        },
      });
      const badEmail = await helpers.createGiftCheckout({ payload: { ...base, recipientEmail: 'nope' } });
      const badReturn = await helpers.createGiftCheckout({
        payload: { ...base, recipientEmail: RECIPIENT, returnPath: 'https://evil.com' },
      });

      expect(tooLate.statusCode).toBe(422);
      expect(badEmail.statusCode).toBe(422);
      expect(badReturn.statusCode).toBe(422);
      expect(calls.sessions).toHaveLength(0);
    });
  });

  describe('purchase webhook and delivery', () => {
    it('stores the gift once and emails the recipient and the buyer right away', async () => {
      const eventId = 'evt_gift_once';

      expect(await buyGift({ eventId })).toBe('created');
      expect(await buyGift({ eventId })).toBe('duplicate');
      expect(await buyGift({ eventType: 'checkout.session.async_payment_succeeded' })).toBe('duplicate');

      expect(emailedCodes()).toHaveLength(1);
      expect(emailedCodes()[0]).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
      expect(sendSpy.mock.calls.filter(([payload]) => payload.to === 'buyer@example.com')).toHaveLength(1);
    });

    it('creates a gift that a 100%-off promotion code paid for', async () => {
      expect(await buyGift({ paymentStatus: 'no_payment_required', paymentIntentId: null })).toBe('created');
      expect(emailedCodes()).toHaveLength(1);
    });

    it('waits for a delayed payment to succeed', async () => {
      expect(await buyGift({ paymentStatus: 'unpaid' })).toBe('ignored');
      expect(sendSpy).not.toHaveBeenCalled();

      expect(await buyGift({ eventType: 'checkout.session.async_payment_succeeded' })).toBe('created');
      expect(emailedCodes()).toHaveLength(1);
    });

    it('retries a failed recipient email on the next cron run', async () => {
      sendSpy.mockResolvedValueOnce({
        data: null,
        error: { name: 'application_error', message: 'Resend is down' },
      } as unknown as Awaited<ReturnType<typeof sendEmailModule.sendEmail>>);

      expect(await buyGift()).toBe('created');
      expect(await giftDeliveryCron.triggerManualSync()).toEqual({ sent: 1, failed: 0 });

      const codes = emailedCodes();
      expect(codes).toHaveLength(2);
      expect(codes[1]).toBe(codes[0]);
    });

    it('holds a scheduled gift until its day, then the cron sends it once', async () => {
      await buyGift({ deliverAt: new Date(Date.now() + 10 * DAY_MS).toISOString() });
      expect(emailedCodes()).toHaveLength(0);

      expect(await giftDeliveryCron.triggerManualSync()).toEqual({ sent: 0, failed: 0 });

      await helpers.backdateGift({ deliverAt: new Date(Date.now() - 1000) });

      expect(await giftDeliveryCron.triggerManualSync()).toEqual({ sent: 1, failed: 0 });
      expect(await giftDeliveryCron.triggerManualSync()).toEqual({ sent: 0, failed: 0 });
      expect(emailedCodes()).toHaveLength(1);
    });
  });

  describe('POST /billing/gifts/redeem', () => {
    it('grants the gifted plan for 12 months and refuses the code a second time', async () => {
      const code = await buyAndReceive({ tier: 'plus' });

      const res = await helpers.redeemGift({ code: code.toLowerCase(), raw: false });

      expect(res.statusCode).toBe(200);
      const { tier, currentPeriodEndsAt } = helpers.extractResponse(res);
      expect(tier).toBe(PLANS.plus);
      expect(currentPeriodEndsAt.slice(0, 10)).toBe(addMonths(new Date(), 12).toISOString().slice(0, 10));

      const { entitlements } = await getUser();
      expect(entitlements!.features).toContain(FEATURES.bank_providers);
      expect(entitlements!.subscriptions).toEqual([
        expect.objectContaining({
          provider: BILLING_PROVIDERS.gift,
          tier: PLANS.plus,
          status: 'active',
          billingCycle: 'year',
          scheduledChange: { action: 'cancel', effectiveAt: currentPeriodEndsAt },
        }),
      ]);

      const again = await helpers.redeemGift({ code });
      expect(again.statusCode).toBe(ERROR_CODES.ConflictError);
    });

    it('rejects an unknown code', async () => {
      const res = await helpers.redeemGift({ code: 'AAAA-BBBB-CCCC' });
      expect(res.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('rejects a code older than 12 months', async () => {
      const code = await buyAndReceive();
      await helpers.backdateGift({ code, sentAt: addMonths(new Date(), -13) });

      const res = await helpers.redeemGift({ code });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('rejects a gift that a lifetime plan already covers and leaves the code usable', async () => {
      const code = await buyAndReceive({ tier: 'essential' });
      await helpers.setUserBilling({ plan: PLANS.plus });
      expect((await helpers.redeemGift({ code })).statusCode).toBe(ERROR_CODES.ConflictError);

      await helpers.setUserBilling({ plan: PLANS.essential });
      expect((await helpers.redeemGift({ code })).statusCode).toBe(ERROR_CODES.ConflictError);

      await helpers.setUserBilling({ plan: PLANS.early_adopter });
      expect((await helpers.redeemGift({ code })).statusCode).toBe(200);
    });

    it('stops a renewing web subscription and starts the gift when its paid period ends', async () => {
      const calls = mockStripe();
      const { id } = await getUser();
      const paidUntil = new Date(Date.now() + 20 * DAY_MS);
      await helpers.sendBillingWebhook({
        payload: helpers.buildStripeSubscriptionEvent({
          userId: id,
          priceId: STRIPE_PRICE_IDS.test.essential.month,
          currentPeriodEndsAt: paidUntil,
        }),
      });
      const code = await buyAndReceive({ tier: 'plus' });

      const { currentPeriodEndsAt } = await helpers.redeemGift({ code, raw: true });

      expect(calls.renewalsStopped).toEqual(['sub_01test']);
      expect(currentPeriodEndsAt.slice(0, 10)).toBe(addMonths(paidUntil, 12).toISOString().slice(0, 10));
      expect((await getUser()).entitlements!.features).not.toContain(FEATURES.bank_providers);

      await helpers.sendBillingWebhook({
        payload: helpers.buildStripeSubscriptionEvent({
          eventType: 'customer.subscription.deleted',
          userId: id,
          status: 'canceled',
          priceId: STRIPE_PRICE_IDS.test.essential.month,
          currentPeriodEndsAt: paidUntil,
          createdAt: new Date(Date.now() + 2000),
        }),
      });

      const { entitlements } = await getUser();
      expect(entitlements!.features).toContain(FEATURES.bank_providers);
      const gift = entitlements!.subscriptions.find((s) => s.provider === BILLING_PROVIDERS.gift)!;
      expect(new Date(gift.currentPeriodStartsAt!).getTime()).toBeLessThanOrEqual(Date.now());
      expect(gift.currentPeriodEndsAt.slice(0, 10)).toBe(addMonths(new Date(), 12).toISOString().slice(0, 10));
    });

    it('queues a second gift behind the first and starts it early when the first is refunded', async () => {
      const essential = await buyAndReceive({ tier: 'essential', paymentIntentId: 'pi_01test' });
      const plus = await buyAndReceive({ tier: 'plus', sessionId: 'cs_gift_02', paymentIntentId: 'pi_gift_02' });
      const first = await helpers.redeemGift({ code: essential, raw: true });

      const second = await helpers.redeemGift({ code: plus, raw: true });

      expect(second.currentPeriodStartsAt).toBe(first.currentPeriodEndsAt);
      expect((await getUser()).entitlements!.features).not.toContain(FEATURES.bank_providers);

      await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });

      const { entitlements } = await getUser();
      expect(entitlements!.features).toContain(FEATURES.bank_providers);
      const queued = entitlements!.subscriptions.find((s) => s.tier === PLANS.plus)!;
      expect(queued.currentPeriodEndsAt.slice(0, 10)).toBe(addMonths(new Date(), 12).toISOString().slice(0, 10));
    });

    it('asks to cancel a renewing App Store subscription first', async () => {
      const code = await buyAndReceive();
      await helpers.arrangeAppleSubscription();

      expect((await helpers.redeemGift({ code })).statusCode).toBe(ERROR_CODES.ConflictError);
      const { entitlements } = await getUser();
      expect(entitlements!.subscriptions.map((s) => s.provider)).toEqual([BILLING_PROVIDERS.apple]);
    });

    it('lets only one of two simultaneous redemptions through', async () => {
      const code = await buyAndReceive();

      const results = await Promise.all([helpers.redeemGift({ code }), helpers.redeemGift({ code })]);

      expect(results.map((r) => r.statusCode)).toEqual(expect.arrayContaining([200, ERROR_CODES.ConflictError]));
      const { entitlements } = await getUser();
      expect(entitlements!.subscriptions.filter((s) => s.provider === BILLING_PROVIDERS.gift)).toHaveLength(1);
    });

    it('blocks a web checkout while the gift runs', async () => {
      const code = await buyAndReceive();
      await helpers.redeemGift({ code, raw: true });

      const res = await helpers.createBillingCheckout({ payload: { tier: 'plus', cycle: 'month' } });

      expect(res.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('refunds', () => {
    it('voids an unredeemed code', async () => {
      const code = await buyAndReceive({ paymentIntentId: 'pi_01test' });

      const refund = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });

      expect(refund.body.outcome).toBe('revoked');
      expect((await helpers.redeemGift({ code })).statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('ends the access of a redeemed gift', async () => {
      const code = await buyAndReceive({ tier: 'plus', paymentIntentId: 'pi_01test' });
      await helpers.redeemGift({ code, raw: true });

      const refund = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });

      expect(refund.body.outcome).toBe('revoked');
      const { entitlements } = await getUser();
      expect(entitlements!.subscriptions[0]).toEqual(
        expect.objectContaining({ provider: BILLING_PROVIDERS.gift, status: 'canceled' }),
      );
    });
  });
});
