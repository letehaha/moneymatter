import {
  NOTIFICATION_TYPES,
  type PushConfigResponse,
  type PushDeviceDto,
  type SendTestPushResponse,
  type SubscribePushRequest,
  type SyncPushSubscriptionRequest,
  type SyncPushSubscriptionResponse,
  type UnsubscribePushRequest,
  type WebPushMessage,
} from '@bt/shared/types';
import { until } from '@common/helpers';
import { type CapturedPushRequest, getCapturedPushRequests } from '@tests/mocks/web-push/mock-api';
import { decrypt } from 'http_ece';
import { createECDH, randomBytes } from 'node:crypto';

import { makeRequest } from './common';
import { createNotification } from './notifications';

/** Host the mocked push service answers on; the suite's allowlist admits `*.push.example.test`. */
export const TEST_PUSH_HOST = 'mock.push.example.test';

export interface BuiltPushSubscription {
  /** The request body for `POST /push/subscriptions` */
  body: SubscribePushRequest & { keys: { p256dh: string; auth: string } };
  /** The browser's private key, which the test needs to decrypt what the backend sends */
  privateKey: Buffer;
  publicKey: Buffer;
  authSecret: Buffer;
}

/**
 * A subscription as a browser would register it: a real P-256 key pair and a 16-byte auth
 * secret, both base64url. `path` becomes the endpoint path (the mocked push service picks its
 * answer from the first segment) and is made unique with a random suffix.
 */
export function buildPushSubscription({
  host = TEST_PUSH_HOST,
  path = 'ok',
  deviceLabel,
}: {
  host?: string;
  path?: string;
  deviceLabel?: string | null;
} = {}): BuiltPushSubscription {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);

  return {
    body: {
      endpoint: `https://${host}/${path}/${randomBytes(12).toString('hex')}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth: authSecret.toString('base64url'),
      },
      expirationTime: null,
      ...(deviceLabel !== undefined && { deviceLabel }),
    },
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
    authSecret,
  };
}

export async function getPushConfig<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<PushConfigResponse, R>({ method: 'get', url: '/push/config', raw });
}

export async function subscribePush<R extends boolean | undefined = undefined>({
  payload,
  raw,
}: {
  payload: Partial<SubscribePushRequest> | Record<string, unknown>;
  raw?: R;
}) {
  return makeRequest<PushDeviceDto, R>({ method: 'post', url: '/push/subscriptions', payload, raw });
}

export async function syncPushSubscription<R extends boolean | undefined = undefined>({
  payload,
  raw,
}: {
  payload: SyncPushSubscriptionRequest;
  raw?: R;
}) {
  return makeRequest<SyncPushSubscriptionResponse, R>({
    method: 'post',
    url: '/push/subscriptions/sync',
    payload,
    raw,
  });
}

export async function listPushDevices<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<PushDeviceDto[], R>({ method: 'get', url: '/push/subscriptions', raw });
}

export async function deletePushDevice<R extends boolean | undefined = undefined>({
  id,
  raw,
}: {
  id: string;
  raw?: R;
}) {
  return makeRequest<void, R>({ method: 'delete', url: `/push/subscriptions/${id}`, raw });
}

export async function unsubscribePush<R extends boolean | undefined = undefined>({
  payload,
  raw,
}: {
  payload: UnsubscribePushRequest;
  raw?: R;
}) {
  return makeRequest<void, R>({ method: 'post', url: '/push/subscriptions/unsubscribe', payload, raw });
}

export async function sendTestPush<R extends boolean | undefined = undefined>({ raw }: { raw?: R } = {}) {
  return makeRequest<SendTestPushResponse, R>({ method: 'post', url: '/push/test', raw });
}

/**
 * Decrypts what the backend sent to a subscription (`aes128gcm`, RFC 8291) with the private
 * material `buildPushSubscription` returned, so a test asserts the exact payload.
 */
export function decryptPushBody({
  body,
  subscription,
}: {
  body: Buffer;
  subscription: BuiltPushSubscription;
}): WebPushMessage {
  const receiver = createECDH('prime256v1');
  receiver.setPrivateKey(subscription.privateKey);

  const plaintext = decrypt(body, { version: 'aes128gcm', privateKey: receiver, authSecret: subscription.authSecret });
  return JSON.parse(plaintext.toString('utf8')) as WebPushMessage;
}

/** The decrypted message of a captured request. */
export const decryptCapturedRequest = ({
  request,
  subscription,
}: {
  request: CapturedPushRequest;
  subscription: BuiltPushSubscription;
}): WebPushMessage => decryptPushBody({ body: request.body, subscription });

/**
 * Waits until the mocked push service has seen `count` requests (for `endpoint` when given) and
 * returns the matching ones.
 */
export async function waitForPushRequests({
  count,
  endpoint,
  timeout = 8000,
}: {
  count: number;
  endpoint?: string;
  timeout?: number;
}): Promise<CapturedPushRequest[]> {
  await until(() => getCapturedPushRequests({ endpoint }).length >= count, { timeout, interval: 25 });
  return getCapturedPushRequests({ endpoint });
}

/**
 * The barrier behind every "no push" case. Absence after a wait proves nothing while a job can
 * still be pending, so the case ends with a `system` notification created over HTTP as the
 * active user. Once its request reaches the mock, the jobs queued before it have been decided.
 * Returns the sentinel's notification id and every request captured so far.
 */
export async function awaitSentinelPush({
  subscription,
}: {
  subscription: BuiltPushSubscription;
}): Promise<{ sentinelId: string; requests: CapturedPushRequest[] }> {
  const sentinel = await createNotification({
    payload: { type: NOTIFICATION_TYPES.system, title: `Sentinel ${randomBytes(4).toString('hex')}` },
    raw: true,
  });

  const { endpoint } = subscription.body;
  await until(
    () =>
      getCapturedPushRequests({ endpoint }).some(
        (request) => decryptCapturedRequest({ request, subscription }).notification.data.notificationId === sentinel.id,
      ),
    { timeout: 8000, interval: 25 },
  );

  return { sentinelId: sentinel.id, requests: getCapturedPushRequests() };
}

/** The notification id a captured request carries. */
export const notificationIdOf = ({
  request,
  subscription,
}: {
  request: CapturedPushRequest;
  subscription: BuiltPushSubscription;
}): string | undefined => decryptCapturedRequest({ request, subscription }).notification.data.notificationId;
