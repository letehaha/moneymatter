import type {
  PushConfigResponse,
  PushDeviceDto,
  SubscribePushRequest,
  SyncPushSubscriptionRequest,
  SyncPushSubscriptionResponse,
  UnsubscribePushRequest,
} from '@bt/shared/types';
import { createECDH, randomBytes } from 'node:crypto';

import { makeRequest } from './common';

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
