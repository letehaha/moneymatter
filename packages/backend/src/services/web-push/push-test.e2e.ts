import { API_ERROR_CODES, NOTIFICATION_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { beforeEach, describe, expect, it } from '@jest/globals';
import PushSubscriptions from '@models/push-subscriptions.model';
import Users from '@models/users.model';
import { FRONTEND_BASE_URL } from '@root/config';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { clearMockSession, registerMockSession } from '@tests/mocks/better-auth';
import { clearCapturedPushRequests, getCapturedPushRequests } from '@tests/mocks/web-push/mock-api';
import { generateVAPIDKeys } from 'web-push';

const NOT_CONFIGURED_MESSAGE = 'Browser notifications are not configured on this server';

const errorOf = (response: { body: { response: unknown } }) => response.body.response as ErrorResponse;

/** Registers a device for the active user, as the Enable tap does. */
async function subscribeDevice({ path = 'ok' }: { path?: string } = {}) {
  const subscription = helpers.buildPushSubscription({ path });
  const response = await helpers.subscribePush({ payload: subscription.body });
  expect(response.statusCode).toBe(201);
  return { subscription, endpoint: subscription.body.endpoint };
}

const listDevices = () => helpers.listPushDevices({ raw: true });

/** Runs `fn` with the VAPID variables cleared, the way an instance without Web Push looks. */
async function withVapidCleared<T>(fn: () => Promise<T>): Promise<T> {
  const saved = {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT,
  };
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  try {
    return await fn();
  } finally {
    process.env.VAPID_PUBLIC_KEY = saved.publicKey;
    process.env.VAPID_PRIVATE_KEY = saved.privateKey;
    process.env.VAPID_SUBJECT = saved.subject;
  }
}

describe('POST /push/test', () => {
  beforeEach(() => {
    clearCapturedPushRequests();
  });

  it('sends the test message to every device of the user and reports the counts', async () => {
    const first = await subscribeDevice();
    const second = await subscribeDevice();

    const result = await helpers.sendTestPush({ raw: true });

    expect(result).toEqual({ sent: 2, failed: 0, removed: 0 });

    for (const { subscription, endpoint } of [first, second]) {
      const [request] = getCapturedPushRequests({ endpoint });
      expect(getCapturedPushRequests({ endpoint })).toHaveLength(1);
      expect(request!.headers.urgency).toBe('high');
      expect(request!.headers.ttl).toBe('120');
      expect(request!.headers['content-encoding']).toBe('aes128gcm');

      expect(helpers.decryptCapturedRequest({ request: request!, subscription })).toEqual({
        web_push: 8030,
        mutable: true,
        notification: {
          title: t({ key: 'webPush.testTitle', locale: 'en' }),
          body: t({ key: 'webPush.testBody', locale: 'en' }),
          navigate: `${FRONTEND_BASE_URL}/settings/notifications`,
          lang: 'en',
          tag: 'push-test',
          silent: false,
          data: { v: 1, kind: 'test', path: '/settings/notifications', unreadCount: 0 },
        },
      });
    }
  });

  it('carries the real unread count so the test message leaves the badge as it is', async () => {
    await helpers.createNotification({
      payload: { type: NOTIFICATION_TYPES.system, title: 'First' },
      raw: true,
    });
    await helpers.createNotification({
      payload: { type: NOTIFICATION_TYPES.system, title: 'Second' },
      raw: true,
    });
    const { subscription, endpoint } = await subscribeDevice();

    await helpers.sendTestPush({ raw: true });

    const [request] = getCapturedPushRequests({ endpoint });
    expect(helpers.decryptCapturedRequest({ request: request!, subscription }).notification.data.unreadCount).toBe(2);
  });

  it('uses the language of the user settings', async () => {
    await helpers.patchUserSettings({ patch: { locale: 'uk' }, raw: true });
    const { subscription, endpoint } = await subscribeDevice();

    await helpers.sendTestPush({ raw: true });

    const [request] = getCapturedPushRequests({ endpoint });
    const { notification } = helpers.decryptCapturedRequest({ request: request!, subscription });
    expect(notification.lang).toBe('uk');
    expect(notification.body).toBe(t({ key: 'webPush.testBody', locale: 'uk' }));
  });

  it('answers zero counts for a user without devices', async () => {
    const result = await helpers.sendTestPush({ raw: true });

    expect(result).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(getCapturedPushRequests()).toHaveLength(0);
  });

  it('does not send to the devices of another user', async () => {
    const other = await helpers.provisionSecondUserWithBaseCurrency();
    const otherDevice = await helpers.asUser({ cookies: other.cookies, fn: () => subscribeDevice() });
    const own = await subscribeDevice();

    const result = await helpers.sendTestPush({ raw: true });

    expect(result).toEqual({ sent: 1, failed: 0, removed: 0 });
    expect(getCapturedPushRequests({ endpoint: own.endpoint })).toHaveLength(1);
    expect(getCapturedPushRequests({ endpoint: otherDevice.endpoint })).toHaveLength(0);
  });

  describe('devices the push service refuses', () => {
    it('removes a device the push service reports gone', async () => {
      await subscribeDevice({ path: 'gone' });

      const result = await helpers.sendTestPush({ raw: true });

      expect(result).toEqual({ sent: 0, failed: 0, removed: 1 });
      expect(await listDevices()).toEqual([]);
    });

    it('removes a device subscribed under another VAPID key without sending to it', async () => {
      const stale = await subscribeDevice();

      const saved = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      const next = generateVAPIDKeys();
      process.env.VAPID_PUBLIC_KEY = next.publicKey;
      process.env.VAPID_PRIVATE_KEY = next.privateKey;
      try {
        const result = await helpers.sendTestPush({ raw: true });

        expect(result).toEqual({ sent: 0, failed: 0, removed: 1 });
        expect(getCapturedPushRequests({ endpoint: stale.endpoint })).toHaveLength(0);
        expect(await listDevices()).toEqual([]);
      } finally {
        process.env.VAPID_PUBLIC_KEY = saved.publicKey;
        process.env.VAPID_PRIVATE_KEY = saved.privateKey;
      }
    });

    it('counts a transient failure once, without retrying, and keeps the device', async () => {
      const { endpoint } = await subscribeDevice({ path: 'flaky' });

      const result = await helpers.sendTestPush({ raw: true });

      expect(result).toEqual({ sent: 0, failed: 1, removed: 0 });
      expect(getCapturedPushRequests({ endpoint })).toHaveLength(1);

      const [device] = await listDevices();
      expect(device!.lastFailureAt).not.toBeNull();
      expect(device!.failureCount).toBe(0);
      expect(await PushSubscriptions.count()).toBe(1);
    });

    it('counts a rejected subscription as failed', async () => {
      await subscribeDevice({ path: 'bad' });

      const result = await helpers.sendTestPush({ raw: true });

      expect(result).toEqual({ sent: 0, failed: 1, removed: 0 });
      expect((await listDevices())[0]!.failureCount).toBe(1);
    });

    it('reports every outcome of a mixed set of devices', async () => {
      await subscribeDevice();
      await subscribeDevice({ path: 'gone' });
      await subscribeDevice({ path: 'flaky' });

      const result = await helpers.sendTestPush({ raw: true });

      expect(result).toEqual({ sent: 1, failed: 1, removed: 1 });
      expect(await listDevices()).toHaveLength(2);
    });
  });

  describe('access', () => {
    it('limits the test message to 5 requests per minute per user', async () => {
      for (let attempt = 1; attempt <= 5; attempt++) {
        const response = await helpers.sendTestPush();
        expect(response.statusCode).toBe(200);
      }

      const blocked = await helpers.sendTestPush();

      expect(blocked.statusCode).toBe(429);
      expect(errorOf(blocked).code).toBe(API_ERROR_CODES.tooManyRequests);
    });

    it('blocks a demo user', async () => {
      const demo = await helpers.makeAuthRequest({ method: 'post', url: '/demo' });
      expect(demo.statusCode).toBe(200);

      const cookies = helpers.extractCookies(demo);
      const sessionToken = cookies.match(/bt_auth\.session_token=([^;]+)/)?.[1];
      const demoUser = await Users.findByPk(demo.body.response.user.id);
      registerMockSession(sessionToken!, { id: demoUser!.authUserId, email: `demo-${demoUser!.id}@demo.local` });

      try {
        const response = await helpers.asUser({ cookies, fn: () => helpers.sendTestPush() });

        expect(response.statusCode).toBe(403);
        expect(errorOf(response).code).toBe(API_ERROR_CODES.forbidden);
      } finally {
        clearMockSession(sessionToken!);
      }
    }, 120_000);

    it('lets a user on a read-only plan send the test message', async () => {
      await subscribeDevice();
      await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });

      const response = await helpers.sendTestPush();

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual({ sent: 1, failed: 0, removed: 0 });
    });

    it('answers 404 with the not-configured message when the feature is off', async () => {
      const { endpoint } = await subscribeDevice();

      await withVapidCleared(async () => {
        const response = await helpers.sendTestPush();

        expect(response.statusCode).toBe(404);
        expect(errorOf(response).message).toBe(NOT_CONFIGURED_MESSAGE);
      });

      expect(getCapturedPushRequests({ endpoint })).toHaveLength(0);
    });
  });
});
