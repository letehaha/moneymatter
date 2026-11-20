import {
  AutoRenewStatus,
  Environment,
  type JWSTransactionDecodedPayload,
  NotificationTypeV2,
  Status,
  Type,
} from '@apple/app-store-server-library';
import { BILLING_PROVIDERS, SUBSCRIPTION_STATUSES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestError } from '@js/errors';
import BillingSubscriptions from '@models/billing-subscriptions.model';
import BillingWebhookEvents from '@models/billing-webhook-events.model';
import * as appleClient from '@services/billing/apple/client';
import * as sendEmailModule from '@services/email/send-email';
import * as helpers from '@tests/helpers';

const DAY = 24 * 60 * 60 * 1000;

const getUser = () => helpers.getUserInfo({ raw: true });
const getEntitlements = async () => (await getUser()).entitlements!;

const notify = async (overrides: Parameters<typeof helpers.buildAppleNotification>[0] = {}) => {
  const res = await helpers.sendAppleNotification({ notification: helpers.buildAppleNotification(overrides) });
  expect(res.statusCode).toBe(200);
  return res.body.outcome as string;
};

describe('App Store Server Notifications (POST /webhooks/apple)', () => {
  beforeEach(() => {
    jest.spyOn(sendEmailModule, 'sendEmail').mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** A subscription bought through our purchase call, so its transactions carry the user's token. */
  const arrangeStore = async ({
    transaction,
    ...state
  }: { transaction?: Partial<JWSTransactionDecodedPayload> } & Partial<
    Omit<helpers.AppleStoreState, 'transaction'>
  > = {}) => {
    const { id: userId, appStoreAccountToken } = await getUser();
    const store = helpers.mockAppleStore({
      transaction: helpers.buildAppleTransaction({ appAccountToken: appStoreAccountToken, ...transaction }),
      ...state,
    });
    return { userId, store };
  };

  it('maps a first SUBSCRIBED notification to the user through the account token', async () => {
    const { userId } = await arrangeStore();

    expect(await notify({ notificationType: NotificationTypeV2.SUBSCRIBED })).toBe('processed');

    const row = await BillingSubscriptions.findOne({ where: { userId } });
    expect(row).toMatchObject({
      provider: BILLING_PROVIDERS.apple,
      status: SUBSCRIPTION_STATUSES.active,
      tier: 'plus',
    });
    expect(await BillingWebhookEvents.count()).toBe(1);
  });

  it('looks the subscription up in the environment the notification came from', async () => {
    const { store } = await arrangeStore();

    await notify({ environment: Environment.SANDBOX });
    expect(store.getState).toHaveBeenCalledWith({
      originalTransactionId: helpers.APPLE_TEST_ORIGINAL_TRANSACTION_ID,
      environment: Environment.SANDBOX,
    });
  });

  it('hands the subscription to the account that resubscribed on the same Apple ID', async () => {
    const second = await helpers.signUpSecondUser();
    const { appStoreAccountToken: secondToken } = await helpers.asUser({ cookies: second.cookies, fn: getUser });
    const { userId, store } = await arrangeStore({ transaction: { appAccountToken: secondToken } });
    await notify({ notificationType: NotificationTypeV2.SUBSCRIBED });

    const { appStoreAccountToken } = await getUser();
    store.state.transaction = { ...store.state.transaction, appAccountToken: appStoreAccountToken };
    await notify({ notificationType: NotificationTypeV2.SUBSCRIBED });

    expect(await BillingSubscriptions.findAll()).toEqual([
      expect.objectContaining({ userId, externalCustomerId: appStoreAccountToken }),
    ]);
  });

  it('ignores a transaction that is not an auto-renewable subscription', async () => {
    await arrangeStore({ transaction: { type: Type.CONSUMABLE } });

    expect(await notify()).toBe('ignored');
    expect(await BillingSubscriptions.count()).toBe(0);
  });

  it('dismisses a replayed notification as a duplicate', async () => {
    await arrangeStore();
    const notificationUUID = crypto.randomUUID();

    expect(await notify({ notificationUUID })).toBe('processed');
    expect(await notify({ notificationUUID })).toBe('duplicate');
    expect((await BillingWebhookEvents.findAll()).map((e) => e.eventId)).toEqual([`apple:${notificationUUID}`]);
  });

  it('moves the period forward on renewal', async () => {
    const { store } = await arrangeStore();
    await notify({ notificationType: NotificationTypeV2.SUBSCRIBED });

    const renewedUntil = Date.now() + 60 * DAY;
    store.state.transaction = { ...store.state.transaction, expiresDate: renewedUntil };
    await notify({ notificationType: NotificationTypeV2.DID_RENEW });

    expect((await getEntitlements()).subscriptions[0]!.currentPeriodEndsAt).toBe(new Date(renewedUntil).toISOString());
  });

  it('turns read-only once a subscription with auto-renew off expires', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });
    const { store } = await arrangeStore();
    await notify({ notificationType: NotificationTypeV2.SUBSCRIBED });

    store.state.renewalInfo = { autoRenewStatus: AutoRenewStatus.OFF };
    await notify({ notificationType: NotificationTypeV2.DID_CHANGE_RENEWAL_STATUS });
    expect((await getEntitlements()).subscriptions[0]!.scheduledChange?.action).toBe('cancel');
    expect((await getEntitlements()).readOnly).toBe(false);

    store.state.status = Status.EXPIRED;
    store.state.transaction = { ...store.state.transaction, expiresDate: Date.now() - 1000 };
    await notify({ notificationType: NotificationTypeV2.EXPIRED });

    const entitlements = await getEntitlements();
    expect(entitlements.subscriptions[0]!.status).toBe(SUBSCRIPTION_STATUSES.canceled);
    expect(entitlements.readOnly).toBe(true);
  });

  it('loses access when the grace period runs out into billing retry', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });
    const { store } = await arrangeStore({
      transaction: { expiresDate: Date.now() - DAY },
      status: Status.BILLING_GRACE_PERIOD,
      renewalInfo: { autoRenewStatus: AutoRenewStatus.ON, gracePeriodExpiresDate: Date.now() + 3 * DAY },
    });
    await notify({ notificationType: NotificationTypeV2.DID_FAIL_TO_RENEW });
    expect((await getEntitlements()).readOnly).toBe(false);

    store.state.status = Status.BILLING_RETRY;
    await notify({ notificationType: NotificationTypeV2.GRACE_PERIOD_EXPIRED });
    expect((await getEntitlements()).readOnly).toBe(true);
  });

  it('cancels on refund and reactivates on a reversed refund', async () => {
    await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });
    const { store } = await arrangeStore();
    await notify({ notificationType: NotificationTypeV2.SUBSCRIBED });

    store.state.transaction = { ...store.state.transaction, revocationDate: Date.now() };
    await notify({ notificationType: NotificationTypeV2.REFUND });
    expect((await getEntitlements()).subscriptions[0]!.status).toBe(SUBSCRIPTION_STATUSES.canceled);
    expect((await getEntitlements()).readOnly).toBe(true);

    store.state.transaction = { ...store.state.transaction, revocationDate: undefined };
    await notify({ notificationType: NotificationTypeV2.REFUND_REVERSED });
    expect((await getEntitlements()).subscriptions[0]!.status).toBe(SUBSCRIPTION_STATUSES.active);
    expect((await getEntitlements()).readOnly).toBe(false);
  });

  it('drops a lookup signed before the one already mirrored as stale', async () => {
    const { store } = await arrangeStore();
    store.state.transaction = { ...store.state.transaction, signedDate: Date.now() + DAY };
    await notify({ notificationType: NotificationTypeV2.SUBSCRIBED });

    store.state.transaction = { ...store.state.transaction, signedDate: Date.now() - DAY, revocationDate: Date.now() };
    expect(await notify({ notificationType: NotificationTypeV2.REFUND })).toBe('stale');
    expect((await getEntitlements()).subscriptions[0]!.status).toBe(SUBSCRIPTION_STATUSES.active);
  });

  it('acknowledges a TEST notification without looking anything up', async () => {
    const { store } = await arrangeStore();

    expect(await notify({ notificationType: NotificationTypeV2.TEST, signedTransactionInfo: null })).toBe('ignored');
    expect(store.getState).not.toHaveBeenCalled();
  });

  it('ignores renewals of a subscription whose account was deleted', async () => {
    const second = await helpers.signUpSecondUser();
    const { appStoreAccountToken } = await helpers.asUser({ cookies: second.cookies, fn: getUser });
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ appAccountToken: appStoreAccountToken }) });
    await notify({ notificationType: NotificationTypeV2.SUBSCRIBED });
    await helpers.asUser({ cookies: second.cookies, fn: () => helpers.deleteUserAccount() });

    expect(await notify({ notificationType: NotificationTypeV2.DID_RENEW })).toBe('ignored');
    expect(await BillingSubscriptions.count()).toBe(0);
  });

  it('answers 500 for a live subscription it cannot map yet, so Apple retries', async () => {
    helpers.mockAppleStore({ transaction: helpers.buildAppleTransaction({ appAccountToken: undefined }) });

    const res = await helpers.sendAppleNotification({ notification: helpers.buildAppleNotification() });
    expect(res.statusCode).toBe(500);
    expect(await BillingWebhookEvents.count()).toBe(0);
  });

  it('answers 400 for a payload Apple did not sign', async () => {
    jest
      .spyOn(appleClient, 'verifyAppleNotification')
      .mockRejectedValue(new BadRequestError({ message: 'Invalid App Store signature.' }));

    const res = await helpers.sendAppleNotification({ body: { signedPayload: 'forged' } });
    expect(res.statusCode).toBe(400);
  });

  it('answers 400 without a signedPayload', async () => {
    const res = await helpers.sendAppleNotification({ body: {} });
    expect(res.statusCode).toBe(400);
  });
});
