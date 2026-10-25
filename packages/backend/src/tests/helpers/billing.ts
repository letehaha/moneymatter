import {
  AutoRenewStatus,
  Environment,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
  NotificationTypeV2,
  type ResponseBodyV2DecodedPayload,
  Status,
  Type,
} from '@apple/app-store-server-library';
import {
  APPLE_PRODUCT_IDS,
  type DayTrialableFeature,
  type Entitlements,
  FEATURE_TRIAL_DAYS,
  type Plan,
  STRIPE_PRICE_IDS,
  SUBSCRIPTION_STATUSES,
} from '@bt/shared/types';
import { jest } from '@jest/globals';
import { APP_USER_CACHE_KEY_PREFIX } from '@middlewares/better-auth';
import FeatureUsages from '@models/feature-usages.model';
import Users from '@models/users.model';
import { app } from '@root/app';
import { API_PREFIX } from '@root/config';
import { redisClient } from '@root/redis-client';
import type { updateUserPlan } from '@services/admin/user-plan.service';
import * as appleClient from '@services/billing/apple/client';
import type { syncAppleTransaction as syncAppleTransactionService } from '@services/billing/apple/sync-transaction.service';
import crypto from 'crypto';
import Stripe from 'stripe';
import request from 'supertest';

import { makeRequest } from './common';

export const STRIPE_TEST_WEBHOOK_SECRET = 'whsec_test_secret';

/**
 * Arrange billing state that no endpoint owns. Only the fields passed are written,
 * so a test can set a trial without clearing a plan.
 */
export async function setUserBilling({
  authUserId = 'test-user-id',
  plan,
  trialEndsAt,
  firstBudgetPlanAt,
}: {
  authUserId?: string;
  plan?: Plan | null;
  trialEndsAt?: Date | null;
  firstBudgetPlanAt?: Date | null;
}): Promise<void> {
  await Users.update(
    {
      ...(plan !== undefined && { plan }),
      ...(trialEndsAt !== undefined && { trialEndsAt }),
      ...(firstBudgetPlanAt !== undefined && { firstBudgetPlanAt }),
    },
    { where: { authUserId } },
  );
  await redisClient.del(`${APP_USER_CACHE_KEY_PREFIX}${authUserId}`);
}

export function startFeatureTrial<R extends boolean | undefined = false>({
  feature,
  raw,
}: {
  feature: string;
  raw?: R;
}) {
  return makeRequest<Entitlements, R>({
    method: 'post',
    url: `/user/feature-trials/${feature}`,
    raw,
  });
}

/** No endpoint moves time, so an elapsed day-based trial is arranged by backdating its start in the DB. */
export async function backdateFeatureTrial({
  userId,
  feature,
}: {
  userId: number;
  feature: DayTrialableFeature;
}): Promise<void> {
  const elapsedMs = FEATURE_TRIAL_DAYS[feature] * 24 * 60 * 60 * 1000 + 1000;
  await FeatureUsages.update({ trialStartedAt: new Date(Date.now() - elapsedMs) }, { where: { userId, feature } });
}

/** Run `fn` with `IS_SELF_HOST=true`, restoring the previous value afterwards. */
export async function withSelfHost<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.IS_SELF_HOST;
  process.env.IS_SELF_HOST = 'true';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.IS_SELF_HOST;
    else process.env.IS_SELF_HOST = previous;
  }
}

const SECOND_MS = 1000;

export function buildStripeSubscriptionEvent({
  eventId = `evt_${crypto.randomUUID()}`,
  eventType = 'customer.subscription.created',
  subscriptionId = 'sub_01test',
  customerId = 'cus_01test',
  userId,
  status = SUBSCRIPTION_STATUSES.active,
  priceId = STRIPE_PRICE_IDS.test.plus.month,
  currentPeriodEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  createdAt = new Date(),
  cancelAt = null,
  cancelAtPeriodEnd = cancelAt !== null,
  pauseCollection = null,
}: {
  eventId?: string;
  eventType?: string;
  subscriptionId?: string;
  customerId?: string;
  userId?: number;
  status?: string;
  priceId?: string;
  currentPeriodEndsAt?: Date | null;
  createdAt?: Date;
  cancelAt?: Date | null;
  cancelAtPeriodEnd?: boolean;
  pauseCollection?: { resumesAt?: Date | null } | null;
} = {}) {
  const unix = (date: Date) => Math.floor(date.getTime() / SECOND_MS);

  return {
    id: eventId,
    object: 'event',
    type: eventType,
    created: unix(createdAt),
    data: {
      object: {
        id: subscriptionId,
        object: 'subscription',
        status,
        customer: customerId,
        metadata: userId === undefined ? {} : { userId: String(userId) },
        cancel_at_period_end: cancelAtPeriodEnd,
        cancel_at: cancelAt ? unix(cancelAt) : null,
        pause_collection: pauseCollection
          ? { behavior: 'void', resumes_at: pauseCollection.resumesAt ? unix(pauseCollection.resumesAt) : null }
          : null,
        items: {
          object: 'list',
          data: [
            {
              id: 'si_01test',
              object: 'subscription_item',
              price: { id: priceId, object: 'price' },
              ...(currentPeriodEndsAt ? { current_period_end: unix(currentPeriodEndsAt) } : {}),
            },
          ],
        },
      },
    },
  };
}

/** POST /webhooks/billing with a `Stripe-Signature` header over the exact bytes sent. */
export async function sendBillingWebhook({
  payload,
  secret = STRIPE_TEST_WEBHOOK_SECRET,
  timestamp = Math.floor(Date.now() / SECOND_MS),
  signature,
}: {
  payload: object;
  secret?: string;
  timestamp?: number;
  signature?: string;
}): Promise<request.Response> {
  const body = JSON.stringify(payload);
  const header = Stripe.webhooks.generateTestHeaderString({ payload: body, secret, timestamp, signature });

  return request(app)
    .post(`${API_PREFIX}/webhooks/billing`)
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', header)
    .send(body);
}

export function createBillingCheckout<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: { tier: string; cycle: string };
  raw?: R;
}) {
  return makeRequest<{ url: string }, R>({
    method: 'post',
    url: '/billing/checkout',
    payload,
    raw,
  });
}

export function createBillingPortalSession<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload?: { flow?: 'subscription_update' };
  raw?: R;
} = {}) {
  return makeRequest<{ url: string }, R>({
    method: 'post',
    url: '/billing/portal',
    payload,
    raw,
  });
}

type AdminUserSummary = Awaited<ReturnType<typeof updateUserPlan>>;

export function adminUpdateUserPlan<R extends boolean | undefined = false>({
  userId,
  payload,
  raw,
}: {
  userId: number | string;
  payload: {
    plan?: Plan | null;
    trialEndsAt?: string | null;
  };
  raw?: R;
}) {
  return makeRequest<AdminUserSummary, R>({
    method: 'patch',
    url: `/admin/users/${userId}/plan`,
    payload,
    raw,
  });
}

export function buildStripeChargeRefundedEvent({ refunded = true }: { refunded?: boolean } = {}) {
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: 'event',
    type: 'charge.refunded',
    created: Math.floor(Date.now() / SECOND_MS),
    data: {
      object: {
        id: 'ch_01test',
        object: 'charge',
        payment_intent: 'pi_01test',
        amount: 5500,
        amount_refunded: refunded ? 5500 : 1000,
        refunded,
      },
    },
  };
}

export function buildStripeDisputeClosedEvent({
  status = 'lost',
  amount = 5500,
}: {
  status?: string;
  amount?: number;
} = {}) {
  return {
    id: `evt_${crypto.randomUUID()}`,
    object: 'event',
    type: 'charge.dispute.closed',
    created: Math.floor(Date.now() / SECOND_MS),
    data: {
      object: {
        id: 'dp_01test',
        object: 'dispute',
        charge: 'ch_01test',
        payment_intent: 'pi_01test',
        amount,
        currency: 'usd',
        status,
      },
    },
  };
}

export const APPLE_TEST_ORIGINAL_TRANSACTION_ID = '2000000000000001';

export function buildAppleTransaction(
  overrides: Partial<JWSTransactionDecodedPayload> = {},
): JWSTransactionDecodedPayload {
  const now = Date.now();
  return {
    originalTransactionId: APPLE_TEST_ORIGINAL_TRANSACTION_ID,
    transactionId: APPLE_TEST_ORIGINAL_TRANSACTION_ID,
    bundleId: 'app.moneymatter.mobile',
    productId: APPLE_PRODUCT_IDS.plus.month,
    type: Type.AUTO_RENEWABLE_SUBSCRIPTION,
    purchaseDate: now,
    expiresDate: now + 30 * 24 * 60 * 60 * 1000,
    signedDate: now,
    environment: Environment.PRODUCTION,
    ...overrides,
  };
}

export interface AppleStoreState {
  status: Status;
  transaction: JWSTransactionDecodedPayload;
  renewalInfo: JWSRenewalInfoDecodedPayload | null;
}

/**
 * Stands in for Apple: every signed transaction decodes to `state.transaction`, a signed
 * notification is its JSON, and the status lookup answers with the current state. Mutate
 * the returned state to move the subscription along.
 */
export function mockAppleStore({
  transaction = buildAppleTransaction(),
  status = Status.ACTIVE,
  renewalInfo = { autoRenewStatus: AutoRenewStatus.ON },
}: Partial<AppleStoreState> = {}) {
  const state: AppleStoreState = { status, transaction, renewalInfo };
  const verifyTransaction = jest
    .spyOn(appleClient, 'verifyAppleTransaction')
    .mockImplementation(async () => state.transaction);
  const getState = jest
    .spyOn(appleClient, 'getAppleSubscriptionState')
    // A real lookup is signed when it is made, so each one is newer than the last.
    .mockImplementation(async () => ({
      ...state,
      transaction: { ...state.transaction, signedDate: Math.max(state.transaction.signedDate ?? 0, Date.now()) },
    }));
  const verifyNotification = jest
    .spyOn(appleClient, 'verifyAppleNotification')
    .mockImplementation(async ({ signedPayload }) => JSON.parse(signedPayload) as ResponseBodyV2DecodedPayload);
  const restore = () => [verifyTransaction, getState, verifyNotification].forEach((spy) => spy.mockRestore());
  return { state, verifyTransaction, getState, restore };
}

/** Mirror an Apple subscription for the current user through the purchase sync, then stop standing in for Apple. */
export async function arrangeAppleSubscription(state: Partial<AppleStoreState> = {}) {
  const store = mockAppleStore(state);
  await syncAppleTransaction({ raw: true });
  store.restore();
}

export function syncAppleTransaction<R extends boolean | undefined = false>({
  signedTransaction = 'signed-transaction',
  raw,
}: {
  signedTransaction?: string;
  raw?: R;
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof syncAppleTransactionService>>, R>({
    method: 'post',
    url: '/billing/apple/transactions',
    payload: { signedTransaction },
    raw,
  });
}

export function buildAppleNotification({
  notificationType = NotificationTypeV2.DID_RENEW,
  notificationUUID = crypto.randomUUID(),
  environment = Environment.PRODUCTION,
  signedTransactionInfo = 'signed-transaction',
}: {
  notificationType?: NotificationTypeV2;
  notificationUUID?: string;
  environment?: Environment;
  signedTransactionInfo?: string | null;
} = {}): ResponseBodyV2DecodedPayload {
  return {
    notificationType,
    notificationUUID,
    version: '2.0',
    signedDate: Date.now(),
    data: {
      environment,
      bundleId: 'app.moneymatter.mobile',
      ...(signedTransactionInfo && { signedTransactionInfo }),
    },
  };
}

/** POST /webhooks/apple. Under `mockAppleStore` the signed payload is the notification's JSON. */
export function sendAppleNotification({
  notification,
  body,
}: {
  notification?: ResponseBodyV2DecodedPayload;
  body?: object;
}): Promise<request.Response> {
  return request(app)
    .post(`${API_PREFIX}/webhooks/apple`)
    .set('Content-Type', 'application/json')
    .send(body ?? { signedPayload: JSON.stringify(notification) });
}
