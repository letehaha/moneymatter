import {
  API_ERROR_CODES,
  FEATURES,
  PLANS,
  PLAN_FEATURES,
  SEATS_BY_PLAN,
  STRIPE_PRICE_IDS,
  SUBSCRIPTION_STATUSES,
} from '@bt/shared/types';
import { NONEXISTENT_ID } from '@common/lib/record-id-helpers';
import { afterEach, describe, expect, it } from '@jest/globals';
import Users from '@models/users.model';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { clearMockSession, registerMockSession } from '@tests/mocks/better-auth';

const DAY = 24 * 60 * 60 * 1000;

const getEntitlements = async () => (await helpers.getUserInfo({ raw: true })).entitlements!;

/** Any non-GET bank-data-providers route; the feature gate runs before validation. */
const bankProviderWrite = () =>
  helpers.bankDataProviders.disconnectProvider({
    connectionId: NONEXISTENT_ID,
  });

describe('Entitlements resolution (GET /user)', () => {
  it('grants plus features to a legacy user with neither plan nor trial', async () => {
    const entitlements = await getEntitlements();

    expect(entitlements.readOnly).toBe(false);
    expect(entitlements.plan).toBeNull();
    expect(entitlements.trialEndsAt).toBeNull();
    expect(entitlements.seats).toBe(SEATS_BY_PLAN.plus);
    expect(entitlements.features.toSorted()).toEqual(PLAN_FEATURES.plus.toSorted());
    expect(entitlements.subscriptions).toEqual([]);
  });

  it('drops a legacy user who subscribed and then cancelled to read-only', async () => {
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, status: SUBSCRIPTION_STATUSES.canceled }),
    });

    const entitlements = await getEntitlements();
    expect(entitlements.trialEndsAt).toBeNull();
    expect(entitlements.plan).toBeNull();
    expect(entitlements.readOnly).toBe(true);
    expect(entitlements.features).toEqual([FEATURES.data_export]);
  });

  it('grants trial features minus backup restore while the trial is running', async () => {
    const trialEndsAt = new Date(Date.now() + 10 * DAY);
    await helpers.setUserBilling({ trialEndsAt });

    const entitlements = await getEntitlements();

    expect(entitlements.readOnly).toBe(false);
    expect(entitlements.trialEndsAt).toEqual(trialEndsAt.toISOString());
    expect(entitlements.features).toContain(FEATURES.bank_providers);
    expect(entitlements.features).toContain(FEATURES.operator_ai);
    expect(entitlements.features).toContain(FEATURES.backup_export);
    expect(entitlements.features).toContain(FEATURES.data_export);
    expect(entitlements.features).not.toContain(FEATURES.backup_restore);
  });

  it('drops an expired trial with no subscription to read-only', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

    const entitlements = await getEntitlements();
    expect(entitlements.readOnly).toBe(true);
    expect(entitlements.features).toEqual([FEATURES.data_export]);

    // Reads keep working.
    expect(await helpers.getAccounts()).toEqual([]);

    const write = await helpers.makeRequest({
      method: 'post',
      url: '/accounts',
      payload: helpers.buildAccountPayload(),
    });
    expect(write.statusCode).toBe(402);
    expect(write.body.response.code).toBe(API_ERROR_CODES.planRequired);

    // Taking the data out survives read-only: data_export is both allowlisted past the
    // read-only guard and the one feature a lapsed user keeps.
    const dataExport = await helpers.exportData();
    expect(dataExport.statusCode).toBe(200);
  });

  it('names the lapsed subscription, not the trial, when a canceled subscriber is read-only', async () => {
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, status: SUBSCRIPTION_STATUSES.canceled }),
    });

    const entitlements = await getEntitlements();
    expect(entitlements.readOnly).toBe(true);

    const write = await helpers.makeRequest({
      method: 'post',
      url: '/accounts',
      payload: helpers.buildAccountPayload(),
    });
    expect(write.statusCode).toBe(402);
    expect(write.body.response.message).toMatch(/subscription has ended/);
  });

  it('lets a read-only user delete their account', async () => {
    const signup = await helpers.makeAuthRequest({
      method: 'post',
      url: '/auth/sign-up/email',
      payload: {
        email: `readonly-delete-${Date.now()}@test.local`,
        password: 'testpassword123',
        name: 'Read Only',
      },
    });
    expect(signup.statusCode).toBe(200);

    await helpers.setUserBilling({
      authUserId: signup.body.user.id,
      trialEndsAt: new Date(Date.now() - DAY),
    });

    const deletion = await helpers.asUser({
      cookies: helpers.extractCookies(signup),
      fn: () => helpers.makeRequest({ method: 'delete', url: '/user/delete' }),
    });
    expect(deletion.statusCode).toBe(200);
  });

  it('lets a read-only user reach POST /auth routes', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

    const res = await helpers.makeRequest({
      method: 'post',
      url: '/auth/set-password',
      payload: { newPassword: 'valid-password-123' },
    });
    expect(res.statusCode).not.toBe(402);
  });

  it('lets a read-only user set their base currency', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

    const res = await helpers.setBaseCurrencyForActiveUser({ currencyCode: 'EUR' });
    expect(res.statusCode).not.toBe(402);
  });

  it('grants plus features to an early adopter, trial expired or not', async () => {
    await helpers.setUserBilling({
      plan: PLANS.early_adopter,
      trialEndsAt: new Date(Date.now() - DAY),
    });

    const entitlements = await getEntitlements();
    expect(entitlements.readOnly).toBe(false);
    expect(entitlements.plan).toBe(PLANS.early_adopter);
    // budget_plan comes from the early adopter budget trial, open until a first plan starts it.
    expect(entitlements.features.toSorted()).toEqual([...PLAN_FEATURES.early_adopter, FEATURES.budget_plan].toSorted());
    expect(entitlements.seats).toBe(SEATS_BY_PLAN.early_adopter);
  });

  it('unions a granted plan with a live subscription and keeps the subscription in the summary', async () => {
    const { id } = await helpers.getUserInfo({ raw: true });
    const webhook = await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, subscriptionId: 'sub_on_top' }),
    });
    expect(webhook.body.outcome).toBe('processed');

    await helpers.setUserBilling({ plan: PLANS.essential });

    const entitlements = await getEntitlements();
    expect(entitlements.plan).toBe(PLANS.essential);
    expect(entitlements.features.toSorted()).toEqual(PLAN_FEATURES.plus.toSorted());
    expect(entitlements.seats).toBe(SEATS_BY_PLAN.plus);
    expect(entitlements.subscriptions.map((s) => s.externalSubscriptionId)).toEqual(['sub_on_top']);
  });

  it('does not entitle a paused subscription', async () => {
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({ userId: id, status: SUBSCRIPTION_STATUSES.paused }),
    });

    const entitlements = await getEntitlements();
    expect(entitlements.readOnly).toBe(true);
    expect(entitlements.subscriptions[0]!.status).toBe(SUBSCRIPTION_STATUSES.paused);
  });

  it('lets a read-only user open checkout and the billing portal', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

    const checkout = await helpers.createBillingCheckout({ payload: { tier: 'plus', cycle: 'month' } });
    expect(checkout.statusCode).not.toBe(402);

    const portal = await helpers.createBillingPortalSession();
    expect(portal.statusCode).not.toBe(402);
  });

  it('grants plus features minus backup and export to a demo user', async () => {
    const demo = await helpers.makeAuthRequest({ method: 'post', url: '/demo' });
    expect(demo.statusCode).toBe(200);

    const cookies = helpers.extractCookies(demo);
    const sessionToken = cookies.match(/bt_auth\.session_token=([^;]+)/)?.[1];
    const demoUser = await Users.findByPk(demo.body.response.user.id);
    registerMockSession(sessionToken!, { id: demoUser!.authUserId, email: `demo-${demoUser!.id}@demo.local` });

    try {
      const entitlements = await helpers.asUser({ cookies, fn: getEntitlements });

      expect(entitlements.readOnly).toBe(false);
      expect(entitlements.seats).toBe(SEATS_BY_PLAN.plus);
      expect(entitlements.features).toContain(FEATURES.bank_providers);
      expect(entitlements.features).toContain(FEATURES.operator_ai);
      expect(entitlements.features).not.toContain(FEATURES.backup_export);
      expect(entitlements.features).not.toContain(FEATURES.backup_restore);
      expect(entitlements.features).not.toContain(FEATURES.data_export);
      expect(entitlements.features).not.toContain(FEATURES.attachments);
    } finally {
      clearMockSession(sessionToken!);
    }
  }, 120_000);

  describe('admin plan grant', () => {
    const originalAdminUsers = process.env.ADMIN_USERS;

    afterEach(() => {
      if (originalAdminUsers === undefined) delete process.env.ADMIN_USERS;
      else process.env.ADMIN_USERS = originalAdminUsers;
    });

    it('grants plus features from a granted plan', async () => {
      process.env.ADMIN_USERS = 'test1';
      const { id } = await helpers.getUserInfo({ raw: true });

      const updated = await helpers.adminUpdateUserPlan({ userId: id, payload: { plan: PLANS.plus }, raw: true });
      expect(updated.entitlements.plan).toBe(PLANS.plus);

      const entitlements = await getEntitlements();
      expect(entitlements.readOnly).toBe(false);
      expect(entitlements.plan).toBe(PLANS.plus);
      expect(entitlements.features.toSorted()).toEqual(PLAN_FEATURES.plus.toSorted());
      expect(entitlements.seats).toBe(SEATS_BY_PLAN.plus);
    });
  });

  it('grants exactly the mirrored tier, not the one above it', async () => {
    const { id } = await helpers.getUserInfo({ raw: true });
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({
        userId: id,
        priceId: STRIPE_PRICE_IDS.test.essential.month,
      }),
    });

    const entitlements = await getEntitlements();
    expect(entitlements.features.toSorted()).toEqual(PLAN_FEATURES.essential.toSorted());
    expect(entitlements.features).not.toContain(FEATURES.bank_providers);
    expect(entitlements.seats).toBe(SEATS_BY_PLAN.essential);
  });

  it('grants every feature on a self-hosted instance even with an expired trial', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

    const entitlements = await helpers.withSelfHost(getEntitlements);
    expect(entitlements.readOnly).toBe(false);
    expect(entitlements.features.toSorted()).toEqual(Object.values(FEATURES).toSorted());
    expect(entitlements.seats).toBe(10);
  });

  describe('gated routes', () => {
    it('allows POST /user/backup for a trial user but rejects POST /user/backup/restore', async () => {
      await helpers.setUserBilling({
        trialEndsAt: new Date(Date.now() + 10 * DAY),
      });

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);

      const restored = await helpers.restoreBackup({ fileContent: 'irrelevant' });
      expect(restored.statusCode).toBe(402);
      expect(restored.code).toBe(API_ERROR_CODES.planRequired);
    });

    it('rejects bank-provider writes for a granted essential plan but not for plus', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });

      const gated = await bankProviderWrite();
      expect(gated.statusCode).toBe(402);
      expect((gated.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);

      await helpers.setUserBilling({ plan: PLANS.plus });

      const allowed = await bankProviderWrite();
      expect(allowed.statusCode).not.toBe(402);
    });

    it('rejects GET /bank-data-providers/sync/check for a read-only user', async () => {
      await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

      const gated = await helpers.makeRequest({
        method: 'get',
        url: '/bank-data-providers/sync/check',
      });

      expect(gated.statusCode).toBe(402);
      expect((gated.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);
    });
  });
});
