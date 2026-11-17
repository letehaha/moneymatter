import { SUBSCRIPTION_STATUSES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import * as helpers from '@tests/helpers';
import { HttpResponse, http } from 'msw';

const DAY = 24 * 60 * 60 * 1000;
const SUBSCRIPTION_ID = 'sub_01test';
const unix = (ms: number) => Math.floor(ms / 1000);

/** Stripe's side: what the lost payment bought, and where that subscription stands now. */
const mockStripe = ({
  paidInvoice = true,
  billingReason = 'subscription_cycle',
  periodEndsAt = Date.now() + 20 * DAY,
  subscriptionParent = true,
  status = 'active',
  chargeAmount = 5500,
  cancelStatus = 200,
}: {
  paidInvoice?: boolean;
  billingReason?: string;
  periodEndsAt?: number;
  subscriptionParent?: boolean;
  status?: string;
  chargeAmount?: number;
  cancelStatus?: number;
} = {}) => {
  const calls = { lookups: [] as string[], canceled: [] as string[] };
  global.mswMockServer.use(
    http.get('https://api.stripe.com/v1/invoice_payments', ({ request }) => {
      calls.lookups.push(decodeURIComponent(new URL(request.url).search));
      return HttpResponse.json({
        object: 'list',
        has_more: false,
        url: '/v1/invoice_payments',
        data: paidInvoice
          ? [
              {
                id: 'inpay_01test',
                object: 'invoice_payment',
                status: 'paid',
                invoice: {
                  id: 'in_01test',
                  object: 'invoice',
                  billing_reason: billingReason,
                  lines: {
                    object: 'list',
                    data: [
                      {
                        id: 'il_01test',
                        object: 'line_item',
                        period: { start: unix(periodEndsAt - 30 * DAY), end: unix(periodEndsAt) },
                      },
                    ],
                  },
                  parent: subscriptionParent
                    ? { type: 'subscription_details', subscription_details: { subscription: SUBSCRIPTION_ID } }
                    : null,
                },
              },
            ]
          : [],
      });
    }),
    http.get('https://api.stripe.com/v1/charges/:id', ({ params }) =>
      HttpResponse.json({ id: params.id, object: 'charge', currency: 'usd', amount: chargeAmount, amount_refunded: 0 }),
    ),
    http.get('https://api.stripe.com/v1/payment_intents/:id', ({ params }) =>
      HttpResponse.json({ id: params.id, object: 'payment_intent', metadata: {} }),
    ),
    http.get('https://api.stripe.com/v1/subscriptions/:id', ({ params }) =>
      HttpResponse.json({ id: params.id, object: 'subscription', status }),
    ),
    http.delete('https://api.stripe.com/v1/subscriptions/:id', ({ params }) => {
      calls.canceled.push(String(params.id));
      return cancelStatus === 200
        ? HttpResponse.json({ id: params.id, object: 'subscription', status: 'canceled' })
        : HttpResponse.json({ error: { type: 'api_error' } }, { status: cancelStatus });
    }),
  );
  return calls;
};

describe('Stripe refund webhook (POST /webhooks/billing)', () => {
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('cancels the subscription in Stripe when its current period invoice is fully refunded', async () => {
    const { id: userId } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId, subscriptionId: SUBSCRIPTION_ID }),
    });
    const calls = mockStripe();

    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });

    expect(res.statusCode).toBe(200);
    expect(res.body.outcome).toBe('canceled');
    expect(calls.canceled).toEqual([SUBSCRIPTION_ID]);
    expect(calls.lookups[0]).toContain('payment[payment_intent]=pi_01test');
    expect(calls.lookups[0]).toContain('status=paid');
    expect(calls.lookups[0]).toContain('expand[0]=data.invoice');
    // Only the customer.subscription.deleted echo moves the mirror.
    const row = await BillingSubscriptions.findOne({ where: { externalSubscriptionId: SUBSCRIPTION_ID } });
    expect(row?.status).toBe(SUBSCRIPTION_STATUSES.active);
  });

  it('leaves a partially refunded subscription alone without asking Stripe', async () => {
    const calls = mockStripe();
    const res = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeChargeRefundedEvent({ refunded: false }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.outcome).toBe('ignored');
    expect(calls.lookups).toHaveLength(0);
    expect(calls.canceled).toHaveLength(0);
  });

  it('ignores a refund of an invoice whose period already ended', async () => {
    const calls = mockStripe({ periodEndsAt: Date.now() - DAY });
    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });
    expect(res.body.outcome).toBe('ignored');
    expect(calls.canceled).toHaveLength(0);
  });

  it('ignores a refund of a plan-change proration invoice', async () => {
    const calls = mockStripe({ billingReason: 'subscription_update' });
    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });
    expect(res.body.outcome).toBe('ignored');
    expect(calls.canceled).toHaveLength(0);
  });

  it('ignores a refunded charge that paid no invoice', async () => {
    const calls = mockStripe({ paidInvoice: false });
    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });
    expect(res.body.outcome).toBe('ignored');
    expect(calls.canceled).toHaveLength(0);
  });

  it('ignores a refunded invoice that belongs to no subscription', async () => {
    const calls = mockStripe({ subscriptionParent: false });
    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });
    expect(res.body.outcome).toBe('ignored');
    expect(calls.canceled).toHaveLength(0);
  });

  it('does not cancel again when Stripe already reports the subscription canceled', async () => {
    const calls = mockStripe({ status: 'canceled' });
    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });
    expect(res.body.outcome).toBe('ignored');
    expect(calls.canceled).toHaveLength(0);
  });

  it('cancels on a dispute lost in full, not on a partial or won one', async () => {
    const calls = mockStripe();
    const partial = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeDisputeClosedEvent({ status: 'lost', amount: 1000 }),
    });
    expect(partial.body.outcome).toBe('ignored');
    const won = await helpers.sendBillingWebhook({ payload: helpers.buildStripeDisputeClosedEvent({ status: 'won' }) });
    expect(won.body.outcome).toBe('ignored');
    expect(calls.canceled).toHaveLength(0);

    const lost = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeDisputeClosedEvent({ status: 'lost' }),
    });
    expect(lost.body.outcome).toBe('canceled');
    expect(calls.canceled).toEqual([SUBSCRIPTION_ID]);
  });

  it('answers 500 so Stripe retries when the cancel call fails', async () => {
    const calls = mockStripe({ cancelStatus: 500 });
    const res = await helpers.sendBillingWebhook({ payload: helpers.buildStripeChargeRefundedEvent() });
    expect(res.statusCode).toBe(500);
    expect(calls.canceled.length).toBeGreaterThan(0);
  });
});
