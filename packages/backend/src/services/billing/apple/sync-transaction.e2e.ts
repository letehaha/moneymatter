import { AutoRenewStatus, Environment, Status } from '@apple/app-store-server-library';
import { Type } from '@apple/app-store-server-library';
import {
  API_ERROR_CODES,
  APPLE_PRODUCT_IDS,
  BILLING_PROVIDERS,
  PLAN_FEATURES,
  PLANS,
  STRIPE_PRICE_IDS,
  SUBSCRIPTION_STATUSES,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestError } from '@js/errors';
import * as sentry from '@js/utils/sentry';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import * as appleClient from '@services/billing/apple/client';
import * as sendEmailModule from '@services/email/send-email';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { UniqueConstraintError } from 'sequelize';

const DAY = 24 * 60 * 60 * 1000;

const getUser = () => helpers.getUserInfo({ raw: true });

describe('App Store purchase sync (POST /billing/apple/transactions)', () => {
  let sendSpy: jest.SpiedFunction<typeof sendEmailModule.sendEmail>;

  beforeEach(() => {
    sendSpy = jest.spyOn(sendEmailModule, 'sendEmail').mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('exposes a stable account token on GET /user', async () => {
    const first = await getUser();
    const second = await getUser();
    expect(first.appStoreAccountToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.appStoreAccountToken).toBe(first.appStoreAccountToken);
  });

  it('mirrors a purchase, unlocks Plus for a read-only user and sends the welcome email once', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });
    expect((await getUser()).entitlements!.readOnly).toBe(true);

    const { id: userId, appStoreAccountToken } = await getUser();
    const expiresDate = Date.now() + 30 * DAY;
    const captureSpy = jest.spyOn(sentry, 'captureException');
    helpers.mockAppleStore({
      transaction: helpers.buildAppleTransaction({ appAccountToken: appStoreAccountToken.toUpperCase(), expiresDate }),
    });

    const { entitlements } = await helpers.syncAppleTransaction({ raw: true });

    expect(entitlements.readOnly).toBe(false);
    expect(entitlements.features.toSorted()).toEqual(PLAN_FEATURES.plus.toSorted());
    expect(entitlements.subscriptions).toEqual([
      expect.objectContaining({
        provider: BILLING_PROVIDERS.apple,
        externalSubscriptionId: helpers.APPLE_TEST_ORIGINAL_TRANSACTION_ID,
        tier: 'plus',
        billingCycle: 'month',
        status: SUBSCRIPTION_STATUSES.active,
        currentPeriodEndsAt: new Date(expiresDate).toISOString(),
        scheduledChange: null,
      }),
    ]);

    const row = await BillingSubscriptions.findOne({ where: { userId } });
    expect(row!.provider).toBe(BILLING_PROVIDERS.apple);
    expect(row!.externalCustomerId).toBe(appStoreAccountToken);

    await helpers.syncAppleTransaction({ raw: true });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it('retries once when a concurrent delivery inserted the row first', async () => {
    helpers.mockAppleStore();
    jest.spyOn(BillingSubscriptions, 'create').mockRejectedValueOnce(new UniqueConstraintError({}) as never);

    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(200);
    expect(await BillingSubscriptions.count()).toBe(1);
  });

  it('is idempotent: a replay returns the same entitlements and keeps one row', async () => {
    const { appStoreAccountToken } = await getUser();
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ appAccountToken: appStoreAccountToken }) });

    const first = await helpers.syncAppleTransaction({ raw: true });
    const replay = await helpers.syncAppleTransaction({ raw: true });

    expect(replay).toEqual(first);
    expect(await BillingSubscriptions.count()).toBe(1);
  });

  it('binds a restored purchase that carries no account token to the caller', async () => {
    const { id: userId } = await getUser();
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ appAccountToken: undefined }) });

    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(200);
    expect((await BillingSubscriptions.findOne({ where: { userId } }))?.provider).toBe(BILLING_PROVIDERS.apple);
  });

  it('answers 409 when the token belongs to another account', async () => {
    const second = await helpers.signUpSecondUser();
    const { appStoreAccountToken: otherToken } = await helpers.asUser({ cookies: second.cookies, fn: getUser });
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ appAccountToken: otherToken }) });

    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(409);
    expect((res.body.response as unknown as ErrorResponse).code).toBe(
      API_ERROR_CODES.subscriptionOwnedByAnotherAccount,
    );
    expect(await BillingSubscriptions.count()).toBe(0);
  });

  it('answers 409 when the subscription is already mirrored for another account', async () => {
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ appAccountToken: undefined }) });
    const second = await helpers.signUpSecondUser();
    await helpers.asUser({ cookies: second.cookies, fn: () => helpers.syncAppleTransaction({ raw: true }) });

    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(409);
    expect((res.body.response as unknown as ErrorResponse).code).toBe(
      API_ERROR_CODES.subscriptionOwnedByAnotherAccount,
    );
  });

  it('lets a re-signup claim a subscription whose account was deleted', async () => {
    const second = await helpers.signUpSecondUser();
    const { appStoreAccountToken: deletedToken } = await helpers.asUser({ cookies: second.cookies, fn: getUser });
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ appAccountToken: deletedToken }) });
    await helpers.asUser({ cookies: second.cookies, fn: () => helpers.syncAppleTransaction({ raw: true }) });
    await helpers.asUser({ cookies: second.cookies, fn: () => helpers.deleteUserAccount() });

    const { id: userId } = await getUser();
    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(200);
    expect((await BillingSubscriptions.findOne({ where: { userId } }))?.provider).toBe(BILLING_PROVIDERS.apple);
  });

  it('moves the subscription to the account that resubscribed on the same Apple ID', async () => {
    const second = await helpers.signUpSecondUser();
    const { appStoreAccountToken: secondToken } = await helpers.asUser({ cookies: second.cookies, fn: getUser });
    const store = helpers.mockAppleStore({
      transaction: helpers.buildAppleTransaction({ appAccountToken: secondToken }),
    });
    await helpers.asUser({ cookies: second.cookies, fn: () => helpers.syncAppleTransaction({ raw: true }) });

    const { id: userId, appStoreAccountToken } = await getUser();
    store.state.transaction = { ...store.state.transaction, appAccountToken: appStoreAccountToken };
    const res = await helpers.syncAppleTransaction();

    expect(res.statusCode).toBe(200);
    expect(await BillingSubscriptions.findAll()).toEqual([
      expect.objectContaining({ userId, externalCustomerId: appStoreAccountToken }),
    ]);
  });

  it('answers 500 for a product the backend does not map yet, so the app retries after a deploy', async () => {
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ productId: 'app.moneymatter.mobile.new' }) });

    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(500);
    expect(await BillingSubscriptions.count()).toBe(0);
  });

  it('answers 400 for a transaction that is not a subscription', async () => {
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ type: Type.CONSUMABLE }) });

    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(400);
  });

  it('answers 400 for a payload Apple did not sign', async () => {
    jest
      .spyOn(appleClient, 'verifyAppleTransaction')
      .mockRejectedValue(new BadRequestError({ message: 'Invalid App Store signature.' }));

    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(400);
  });

  it('answers 422 without a signed transaction', async () => {
    const res = await helpers.syncAppleTransaction({ signedTransaction: '' });
    expect(res.statusCode).toBe(422);
  });

  it('looks the subscription up in the environment the transaction came from', async () => {
    const { getState } = helpers.mockAppleStore({
      transaction: helpers.buildAppleTransaction({ environment: Environment.SANDBOX }),
    });

    await helpers.syncAppleTransaction({ raw: true });
    expect(getState).toHaveBeenCalledWith({
      originalTransactionId: helpers.APPLE_TEST_ORIGINAL_TRANSACTION_ID,
      environment: Environment.SANDBOX,
    });
  });

  it('records the purchase and reports it when a Stripe subscription is already live', async () => {
    const { id: userId } = await getUser();
    await helpers.sendBillingWebhook({
      payload: helpers.buildStripeSubscriptionEvent({
        userId,
        priceId: STRIPE_PRICE_IDS.test.essential.month,
      }),
    });
    const captureSpy = jest.spyOn(sentry, 'captureException');
    helpers.mockAppleStore();

    const { entitlements } = await helpers.syncAppleTransaction({ raw: true });

    expect(entitlements.subscriptions.map((s) => s.provider).toSorted()).toEqual(['apple', 'stripe']);
    expect(entitlements.features.toSorted()).toEqual(PLAN_FEATURES.plus.toSorted());
    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ liveStripeIds: ['sub_01test'] }),
      }),
    );
  });

  it('records an early adopter buying the plan they own for life, and reports it', async () => {
    await helpers.setUserBilling({ plan: PLANS.essential });
    const captureSpy = jest.spyOn(sentry, 'captureException');
    helpers.mockAppleStore({
      transaction: helpers.buildAppleTransaction({ productId: APPLE_PRODUCT_IDS.essential.year }),
    });

    const res = await helpers.syncAppleTransaction();
    expect(res.statusCode).toBe(200);
    expect(await BillingSubscriptions.count()).toBe(1);
    expect(captureSpy).toHaveBeenCalledWith(
      expect.objectContaining({ context: expect.objectContaining({ plan: PLANS.essential }) }),
    );
  });

  describe('status mapping', () => {
    it('schedules a cancel when auto-renew is off', async () => {
      const expiresDate = Date.now() + 10 * DAY;
      helpers.mockAppleStore({
        transaction: helpers.buildAppleTransaction({ expiresDate }),
        renewalInfo: { autoRenewStatus: AutoRenewStatus.OFF },
      });

      const { entitlements } = await helpers.syncAppleTransaction({ raw: true });
      expect(entitlements.subscriptions[0]!.scheduledChange).toEqual({
        action: 'cancel',
        effectiveAt: new Date(expiresDate).toISOString(),
      });
    });

    it('keeps access through the grace period', async () => {
      const graceEndsAt = Date.now() + 6 * DAY;
      helpers.mockAppleStore({
        transaction: helpers.buildAppleTransaction({ expiresDate: Date.now() - DAY }),
        status: Status.BILLING_GRACE_PERIOD,
        renewalInfo: { autoRenewStatus: AutoRenewStatus.ON, gracePeriodExpiresDate: graceEndsAt },
      });

      const { entitlements } = await helpers.syncAppleTransaction({ raw: true });
      expect(entitlements.readOnly).toBe(false);
      expect(entitlements.subscriptions[0]).toMatchObject({
        status: SUBSCRIPTION_STATUSES.past_due,
        currentPeriodEndsAt: new Date(graceEndsAt).toISOString(),
      });
    });

    it('grants nothing in billing retry once the period has ended', async () => {
      await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });
      helpers.mockAppleStore({
        transaction: helpers.buildAppleTransaction({ expiresDate: Date.now() - DAY }),
        status: Status.BILLING_RETRY,
      });

      const { entitlements } = await helpers.syncAppleTransaction({ raw: true });
      expect(entitlements.subscriptions[0]!.status).toBe(SUBSCRIPTION_STATUSES.past_due);
      expect(entitlements.readOnly).toBe(true);
    });

    it('cancels at once on a refund, even while Apple still reports it active', async () => {
      await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });
      helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ revocationDate: Date.now() }) });

      const { entitlements } = await helpers.syncAppleTransaction({ raw: true });
      expect(entitlements.subscriptions[0]!.status).toBe(SUBSCRIPTION_STATUSES.canceled);
      expect(entitlements.readOnly).toBe(true);
      expect(sendSpy).not.toHaveBeenCalled();
    });
  });
});
