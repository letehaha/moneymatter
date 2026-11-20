import { afterEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { HttpResponse, http } from 'msw';

const PORTAL_URL = 'https://billing.stripe.com/p/session/test_01';
const DAY = 24 * 60 * 60 * 1000;

const arrangeSubscription = async () => {
  const { id } = await helpers.getUserInfo({ raw: true });
  await helpers.sendBillingWebhook({
    payload: helpers.buildStripeSubscriptionEvent({ userId: id }),
  });
};

const mockPortalSession = () => {
  let body = '';
  global.mswMockServer.use(
    http.post('https://api.stripe.com/v1/billing_portal/sessions', async ({ request }) => {
      body = await request.text();
      return HttpResponse.json({ id: 'bps_test_01', object: 'billing_portal.session', url: PORTAL_URL });
    }),
  );
  return () => new URLSearchParams(body);
};

describe('Billing portal (POST /billing/portal)', () => {
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  it('returns 404 when the user has no billing account yet', async () => {
    const res = await helpers.createBillingPortalSession();
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 pointing to the App Store when the only subscription is billed there', async () => {
    await helpers.arrangeAppleSubscription();
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';

    const res = await helpers.createBillingPortalSession();
    expect(res.statusCode).toBe(404);
    expect((res.body.response as unknown as ErrorResponse).message).toContain('App Store');
  });

  it('opens the portal for the Stripe customer when an App Store subscription came later', async () => {
    await arrangeSubscription();
    await helpers.arrangeAppleSubscription();
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    const params = mockPortalSession();

    await helpers.createBillingPortalSession({ payload: { flow: 'subscription_update' }, raw: true });
    expect(params().get('customer')).toBe('cus_01test');
    expect(params().get('flow_data[subscription_update][subscription]')).toBe('sub_01test');
  });

  it('is not exposed on a self-hosted instance', async () => {
    await arrangeSubscription();

    const res = await helpers.withSelfHost(() => helpers.createBillingPortalSession());
    expect(res.statusCode).toBe(404);
  });

  it('returns the portal url minted by Stripe for the mirrored customer', async () => {
    await arrangeSubscription();
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    const params = mockPortalSession();

    const res = await helpers.createBillingPortalSession({ raw: true });
    expect(res.url).toBe(PORTAL_URL);
    expect(params().get('customer')).toBe('cus_01test');
    expect(params().get('return_url')).toContain('/settings/plan-billing');
    expect(params().get('flow_data[type]')).toBeNull();
  });

  it('opens the plan-switch flow on the entitled subscription', async () => {
    await arrangeSubscription();
    process.env.STRIPE_SECRET_KEY = 'sk_test_key';
    const params = mockPortalSession();

    const res = await helpers.createBillingPortalSession({
      payload: { flow: 'subscription_update' },
      raw: true,
    });
    expect(res.url).toBe(PORTAL_URL);
    expect(params().get('flow_data[type]')).toBe('subscription_update');
    expect(params().get('flow_data[subscription_update][subscription]')).toBe('sub_01test');
    expect(params().get('flow_data[after_completion][type]')).toBe('redirect');
    expect(params().get('flow_data[after_completion][redirect][return_url]')).toBe(params().get('return_url'));
  });

  it('refuses the plan-switch flow when the only subscription is canceled', async () => {
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, status: 'canceled' }),
    });

    const res = await helpers.createBillingPortalSession({ payload: { flow: 'subscription_update' } });
    expect(res.statusCode).toBe(404);
  });

  it('refuses the plan-switch flow when the active subscription period has elapsed', async () => {
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, currentPeriodEndsAt: new Date(Date.now() - DAY) }),
    });

    const res = await helpers.createBillingPortalSession({ payload: { flow: 'subscription_update' } });
    expect(res.statusCode).toBe(404);
  });
});
