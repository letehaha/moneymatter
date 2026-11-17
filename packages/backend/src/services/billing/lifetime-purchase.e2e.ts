import { PLANS } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as sendEmailModule from '@services/email/send-email';
import * as helpers from '@tests/helpers';
import { HttpResponse, http } from 'msw';

const getUser = () => helpers.getUserInfo({ raw: true });

/** Stripe's side: PaymentIntent metadata persists between the grant and a later refund. */
const mockStripe = () => {
  const calls = { paymentIntents: {} as Record<string, Record<string, string>>, renewalsStopped: [] as string[] };
  global.mswMockServer.use(
    http.post('https://api.stripe.com/v1/payment_intents/:id', async ({ params, request }) => {
      const form = new URLSearchParams(await request.text());
      const metadata: Record<string, string> = {};
      form.forEach((value, key) => {
        const match = key.match(/^metadata\[(.+)\]$/);
        if (match) metadata[match[1]!] = value;
      });
      calls.paymentIntents[String(params.id)] = metadata;
      return HttpResponse.json({ id: params.id, object: 'payment_intent', metadata });
    }),
    http.get('https://api.stripe.com/v1/payment_intents/:id', ({ params }) =>
      HttpResponse.json({
        id: params.id,
        object: 'payment_intent',
        metadata: calls.paymentIntents[String(params.id)] ?? {},
      }),
    ),
    http.post('https://api.stripe.com/v1/subscriptions/:id', async ({ params, request }) => {
      if (new URLSearchParams(await request.text()).get('cancel_at_period_end') === 'true') {
        calls.renewalsStopped.push(String(params.id));
      }
      return HttpResponse.json({ id: params.id, object: 'subscription', status: 'active' });
    }),
    http.get('https://api.stripe.com/v1/invoice_payments', () =>
      HttpResponse.json({ object: 'list', has_more: false, url: '/v1/invoice_payments', data: [] }),
    ),
  );
  return calls;
};

describe('Stripe lifetime purchase (POST /webhooks/billing)', () => {
  let sendSpy: jest.SpiedFunction<typeof sendEmailModule.sendEmail>;

  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    sendSpy = jest.spyOn(sendEmailModule, 'sendEmail').mockResolvedValue(null);
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    sendSpy.mockRestore();
  });

  it('grants the plan to the account in client_reference_id and stamps the payment', async () => {
    const calls = mockStripe();
    const { id } = await getUser();

    const res = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: String(id) }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.outcome).toBe('granted');
    expect((await getUser()).entitlements!.plan).toBe(PLANS.essential);
    expect(calls.paymentIntents.pi_01test).toEqual({ userId: String(id), lifetime_plan: 'essential' });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the checkout email when no account id is passed', async () => {
    mockStripe();
    const { email } = await getUser();

    const res = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ email: email!.toUpperCase() }),
    });

    expect(res.body.outcome).toBe('granted');
    expect((await getUser()).entitlements!.plan).toBe(PLANS.essential);
  });

  it('falls back to the checkout email when the account id matches no user', async () => {
    mockStripe();
    const { email } = await getUser();

    const res = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: '999999', email: email! }),
    });

    expect(res.body.outcome).toBe('granted');
  });

  it('grants a delayed payment once it succeeds, not when the session completes unpaid', async () => {
    mockStripe();
    const clientReferenceId = String((await getUser()).id);

    const completed = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId, paymentStatus: 'unpaid' }),
    });
    const succeeded = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({
        clientReferenceId,
        eventType: 'checkout.session.async_payment_succeeded',
      }),
    });

    expect(completed.body.outcome).toBe('ignored');
    expect(succeeded.body.outcome).toBe('granted');
    expect((await getUser()).entitlements!.plan).toBe(PLANS.essential);
  });

  it('processes a redelivered event once', async () => {
    mockStripe();
    const { id } = await getUser();
    const payload = helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: String(id) });

    await helpers.sendBillingWebhook({ payload });
    const res = await helpers.sendBillingWebhook({ payload });

    expect(res.body.outcome).toBe('duplicate');
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('ignores subscription checkouts, unpaid sessions and payments without the lifetime marker', async () => {
    const calls = mockStripe();
    const clientReferenceId = String((await getUser()).id);

    for (const payload of [
      helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId, mode: 'subscription' }),
      helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId, paymentStatus: 'unpaid' }),
      helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId, metadata: {} }),
      helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId, metadata: { lifetime_plan: 'gold' } }),
    ]) {
      const res = await helpers.sendBillingWebhook({ payload });
      expect(res.body.outcome).toBe('ignored');
    }
    expect((await getUser()).entitlements!.plan).toBeNull();
    expect(calls.paymentIntents).toEqual({});
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('answers 200 without granting when the payment matches no account', async () => {
    const calls = mockStripe();

    const res = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: '999999', email: 'nobody@test.local' }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.body.outcome).toBe('unmatched');
    expect(calls.paymentIntents).toEqual({});
  });

  it.each([PLANS.early_adopter, PLANS.essential])('leaves an account already on %s untouched', async (plan) => {
    const calls = mockStripe();
    await helpers.setUserBilling({ plan });
    const { id } = await getUser();

    const res = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: String(id) }),
    });

    expect(res.body.outcome).toBe('conflict');
    expect((await getUser()).entitlements!.plan).toBe(plan);
    expect(calls.paymentIntents).toEqual({});
  });

  it('stops renewals of a running Stripe subscription', async () => {
    const calls = mockStripe();
    const { id } = await getUser();
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, subscriptionId: 'sub_running' }),
    });

    const res = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: String(id) }),
    });

    expect(res.body.outcome).toBe('granted');
    expect(calls.renewalsStopped).toEqual(['sub_running']);
  });

  it('revokes the plan when the lifetime payment is refunded', async () => {
    mockStripe();
    const { id } = await getUser();
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: String(id) }),
    });

    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });

    expect(res.body.outcome).toBe('revoked');
    expect((await getUser()).entitlements!.plan).toBeNull();
  });

  it('revokes on a dispute lost in full and keeps the plan on a partial refund', async () => {
    mockStripe();
    global.mswMockServer.use(
      http.get('https://api.stripe.com/v1/charges/:id', ({ params }) =>
        HttpResponse.json({ id: params.id, object: 'charge', currency: 'usd', amount: 5500, amount_refunded: 0 }),
      ),
    );
    const { id } = await getUser();
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: String(id) }),
    });

    const partial = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeChargeRefundedEvent({ refunded: false }),
    });
    expect(partial.body.outcome).toBe('ignored');
    expect((await getUser()).entitlements!.plan).toBe(PLANS.essential);

    const lost = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeDisputeClosedEvent({ status: 'lost' }),
    });
    expect(lost.body.outcome).toBe('revoked');
    expect((await getUser()).entitlements!.plan).toBeNull();
  });

  it('does not touch a plan changed after the purchase when the payment is refunded', async () => {
    mockStripe();
    const { id } = await getUser();
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeCheckoutCompletedEvent({ clientReferenceId: String(id) }),
    });
    await helpers.setUserBilling({ plan: PLANS.plus });

    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });

    expect(res.body.outcome).toBe('ignored');
    expect((await getUser()).entitlements!.plan).toBe(PLANS.plus);
  });
});
