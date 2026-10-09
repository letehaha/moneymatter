import { PLANS, STRIPE_PRICE_IDS } from '@bt/shared/types';
import { afterEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import { HttpResponse, http } from 'msw';

const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_01';
const RETURN_PATH = '/settings/plan-billing';

const payload = { tier: 'plus', cycle: 'year' };

/** Counts the Stripe calls so a guard can be proven to have short-circuited before them. */
const mockCheckoutSession = () => {
  const calls = { count: 0 };
  global.mswMockServer.use(
    http.post('https://api.stripe.com/v1/checkout/sessions', () => {
      calls.count += 1;
      return HttpResponse.json({ id: 'cs_test_guard', object: 'checkout.session', url: CHECKOUT_URL });
    }),
  );
  return calls;
};

/** Stripe's own view of the customer's subscriptions, consulted while the mirror may still be empty. */
const mockSubscriptionsList = ({ statuses = [] }: { statuses?: string[] } = {}) => {
  global.mswMockServer.use(
    http.get('https://api.stripe.com/v1/subscriptions', () =>
      HttpResponse.json({
        object: 'list',
        has_more: false,
        url: '/v1/subscriptions',
        data: statuses.map((status, index) => ({ id: `sub_live_${index}`, object: 'subscription', status })),
      }),
    ),
  );
};

describe('Billing checkout (POST /billing/checkout)', () => {
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('returns the hosted checkout url and passes our identity to Stripe', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';

    let body = '';
    global.mswMockServer.use(
      http.post('https://api.stripe.com/v1/checkout/sessions', async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ id: 'cs_test_01', object: 'checkout.session', url: CHECKOUT_URL });
      }),
    );

    const res = await helpers.createBillingCheckout({ payload, raw: true });
    expect(res.url).toBe(CHECKOUT_URL);

    const params = new URLSearchParams(body);
    const { id, email } = await helpers.getUserInfo({ raw: true });
    expect(email).toBeTruthy();
    expect(params.get('customer_email')).toBe(email);
    expect(params.get('mode')).toBe('subscription');
    expect(params.get('line_items[0][price]')).toBe(STRIPE_PRICE_IDS.test.plus.year);
    expect(params.get('managed_payments[enabled]')).toBe('true');
    expect(params.get('client_reference_id')).toBe(String(id));
    expect(params.get('subscription_data[metadata][userId]')).toBe(String(id));
    expect(params.get('success_url')).toContain(`${RETURN_PATH}?checkout=success`);
    expect(params.get('customer')).toBeNull();
    expect(params.get('discounts[0][coupon]')).toBeNull();
    expect(params.get('allow_promotion_codes')).toBe('true');
  });

  it('rejects checkout while a subscription is entitled, without calling Stripe', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({ payload: helpers.buildStripeSubscriptionEvent({ userId: id }) });
    const calls = mockCheckoutSession();

    const res = await helpers.createBillingCheckout({ payload });
    expect(res.statusCode).toBe(422);
    expect(calls.count).toBe(0);
  });

  it('rejects checkout while a paused subscription exists, without calling Stripe', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, status: 'paused' }),
    });
    const calls = mockCheckoutSession();

    const res = await helpers.createBillingCheckout({ payload });
    expect(res.statusCode).toBe(422);
    expect(calls.count).toBe(0);
  });

  it('rejects buying the tier already owned for life, without calling Stripe', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    await helpers.setUserBilling({ plan: PLANS.essential });
    const calls = mockCheckoutSession();

    const res = await helpers.createBillingCheckout({ payload: { tier: 'essential', cycle: 'year' } });
    expect(res.statusCode).toBe(422);
    expect(calls.count).toBe(0);
  });

  it('applies the lifetime early-adopter coupon without opening a promotion-code field', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    await helpers.setUserBilling({ plan: PLANS.early_adopter });

    let body = '';
    global.mswMockServer.use(
      http.post('https://api.stripe.com/v1/checkout/sessions', async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ id: 'cs_test_03', object: 'checkout.session', url: CHECKOUT_URL });
      }),
    );

    await helpers.createBillingCheckout({ payload, raw: true });
    const params = new URLSearchParams(body);
    expect(params.get('discounts[0][coupon]')).toBe('early_adopter_50');
    expect(params.get('allow_promotion_codes')).toBeNull();
  });

  it('rejects checkout when Stripe still holds a live subscription the mirror has not seen', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, status: 'canceled' }),
    });
    mockSubscriptionsList({ statuses: ['active'] });
    const calls = mockCheckoutSession();

    const res = await helpers.createBillingCheckout({ payload });
    expect(res.statusCode).toBe(422);
    expect(calls.count).toBe(0);
  });

  it('reuses the Stripe customer of a canceled subscription', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, customerId: 'cus_returning', status: 'canceled' }),
    });
    mockSubscriptionsList();

    let body = '';
    global.mswMockServer.use(
      http.post('https://api.stripe.com/v1/checkout/sessions', async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({ id: 'cs_test_02', object: 'checkout.session', url: CHECKOUT_URL });
      }),
    );

    await helpers.createBillingCheckout({ payload, raw: true });
    const params = new URLSearchParams(body);
    expect(params.get('customer')).toBe('cus_returning');
    expect(params.get('customer_email')).toBeNull();
  });

  it('allows checkout when the only mirrored row expired before it was ever paid', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, status: 'incomplete_expired' }),
    });
    mockSubscriptionsList();
    const calls = mockCheckoutSession();

    const res = await helpers.createBillingCheckout({ payload, raw: true });
    expect(res.url).toBe(CHECKOUT_URL);
    expect(calls.count).toBe(1);
  });

  it('rejects a tier that is not for sale', async () => {
    const res = await helpers.createBillingCheckout({ payload: { tier: 'early_adopter', cycle: 'year' } });
    expect(res.statusCode).toBe(422);
  });

  it('rejects an unknown billing cycle', async () => {
    const res = await helpers.createBillingCheckout({ payload: { tier: 'plus', cycle: 'weekly' } });
    expect(res.statusCode).toBe(422);
  });

  it('is not exposed on a self-hosted instance', async () => {
    const res = await helpers.withSelfHost(() => helpers.createBillingCheckout({ payload }));
    expect(res.statusCode).toBe(404);
  });
});
