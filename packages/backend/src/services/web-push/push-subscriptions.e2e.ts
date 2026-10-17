import { API_ERROR_CODES, API_RESPONSE_STATUS } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import PushSubscriptions from '@models/push-subscriptions.model';
import Users from '@models/users.model';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { clearMockSession, registerMockSession } from '@tests/mocks/better-auth';
import { createHash } from 'node:crypto';

const NOT_CONFIGURED_MESSAGE = 'Browser notifications are not configured on this server';
const ENDPOINT_NOT_ALLOWED_MESSAGE = 'This push endpoint is not allowed';
const INVALID_KEYS_MESSAGE = 'The push subscription keys are invalid';
const NOT_FOUND_MESSAGE = 'Push subscription not found';

const endpointHash = ({ endpoint }: { endpoint: string }) =>
  createHash('sha256').update(endpoint).digest('hex').slice(0, 16);

const errorOf = (response: { body: { response: unknown } }) => response.body.response as ErrorResponse;

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

describe('Push subscriptions API', () => {
  describe('GET /push/config', () => {
    it('reports the feature on with the instance public key', async () => {
      const config = await helpers.getPushConfig({ raw: true });

      expect(config).toEqual({ enabled: true, vapidPublicKey: process.env.VAPID_PUBLIC_KEY });
    });

    it('reports the feature off without the key when VAPID is not configured, and subscribe and sync answer 404', async () => {
      await withVapidCleared(async () => {
        expect(await helpers.getPushConfig({ raw: true })).toEqual({ enabled: false, vapidPublicKey: null });

        const subscription = helpers.buildPushSubscription();
        const subscribe = await helpers.subscribePush({ payload: subscription.body });
        expect(subscribe.statusCode).toBe(404);
        expect(errorOf(subscribe).message).toBe(NOT_CONFIGURED_MESSAGE);

        const sync = await helpers.syncPushSubscription({ payload: { endpoint: subscription.body.endpoint } });
        expect(sync.statusCode).toBe(404);
        expect(errorOf(sync).message).toBe(NOT_CONFIGURED_MESSAGE);
      });
    });

    it('requires a session', async () => {
      const response = await helpers.withoutSession(() => helpers.getPushConfig());

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /push/subscriptions', () => {
    it('is empty for a fresh user', async () => {
      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
    });

    it('keeps listing and removing devices while the feature is off', async () => {
      const subscription = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: subscription.body, raw: true });

      await withVapidCleared(async () => {
        expect(await helpers.listPushDevices({ raw: true })).toHaveLength(1);

        const removed = await helpers.deletePushDevice({ id: created.id });
        expect(removed.statusCode).toBe(200);
      });

      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
    });
  });

  describe('POST /push/subscriptions (enable)', () => {
    it('creates the device with 201 and lists it without the endpoint or keys', async () => {
      const subscription = helpers.buildPushSubscription({ deviceLabel: 'Safari on macOS' });

      const response = await helpers.subscribePush({ payload: subscription.body });
      expect(response.statusCode).toBe(201);
      expect(response.body.status).toBe(API_RESPONSE_STATUS.success);

      const devices = await helpers.listPushDevices({ raw: true });
      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({
        id: response.body.response.id,
        deviceLabel: 'Safari on macOS',
        endpointHost: 'mock.push.example.test',
        endpointHash: endpointHash({ endpoint: subscription.body.endpoint }),
        failureCount: 0,
        lastSuccessAt: null,
        lastFailureAt: null,
      });

      const serialized = JSON.stringify([response.body.response, devices]);
      expect(serialized).not.toContain(subscription.body.endpoint);
      expect(serialized).not.toContain(subscription.body.keys.p256dh);
      expect(serialized).not.toContain(subscription.body.keys.auth);
      expect(serialized).not.toContain('"endpoint"');
      expect(serialized).not.toContain('"p256dh"');
      expect(serialized).not.toContain('"auth"');
    });

    it('answers 200 for the same endpoint again, keeping one row with the keys and label updated', async () => {
      const first = helpers.buildPushSubscription({ deviceLabel: 'Old label' });
      const created = await helpers.subscribePush({ payload: first.body });
      expect(created.statusCode).toBe(201);

      const second = helpers.buildPushSubscription();
      const again = await helpers.subscribePush({
        payload: { ...second.body, endpoint: first.body.endpoint, deviceLabel: '  Renamed   device ' },
      });
      expect(again.statusCode).toBe(200);
      expect(again.body.response.id).toBe(created.body.response.id);

      const devices = await helpers.listPushDevices({ raw: true });
      expect(devices).toHaveLength(1);
      expect(devices[0]!.deviceLabel).toBe('Renamed device');

      const row = await PushSubscriptions.findOne({ where: { endpoint: first.body.endpoint } });
      expect(row!.p256dh).toBe(second.body.keys.p256dh);
      expect(row!.auth).toBe(second.body.keys.auth);
    });

    it('moves the row to the caller when another account subscribes the same endpoint', async () => {
      const subscription = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: subscription.body, raw: true });

      const other = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const moved = await helpers.subscribePush({ payload: subscription.body });
          expect(moved.statusCode).toBe(200);
          expect(moved.body.response.id).toBe(created.id);
          expect(await helpers.listPushDevices({ raw: true })).toHaveLength(1);
        },
      });

      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
    });
  });

  describe('POST /push/subscriptions (rotate)', () => {
    it('updates the caller own row in place', async () => {
      const first = helpers.buildPushSubscription({ deviceLabel: 'Work laptop' });
      const created = await helpers.subscribePush({ payload: first.body, raw: true });
      await PushSubscriptions.update({ failureCount: 4 }, { where: { id: created.id } });
      const createdRow = await PushSubscriptions.findByPk(created.id);

      const next = helpers.buildPushSubscription();
      const rotated = await helpers.subscribePush({
        payload: { ...next.body, oldEndpoint: first.body.endpoint },
      });
      expect(rotated.statusCode).toBe(200);
      expect(rotated.body.response.id).toBe(created.id);

      const devices = await helpers.listPushDevices({ raw: true });
      expect(devices).toHaveLength(1);
      expect(devices[0]).toMatchObject({
        id: created.id,
        // The worker sends no label, so the stored one stays.
        deviceLabel: 'Work laptop',
        endpointHash: endpointHash({ endpoint: next.body.endpoint }),
        failureCount: 0,
      });

      const row = await PushSubscriptions.findByPk(created.id);
      expect(row!.endpoint).toBe(next.body.endpoint);
      expect(row!.p256dh).toBe(next.body.keys.p256dh);
      expect(row!.auth).toBe(next.body.keys.auth);
      expect(row!.userId).toBe(createdRow!.userId);
      expect(row!.createdAt.getTime()).toBe(createdRow!.createdAt.getTime());
    });

    it('is idempotent when the worker rotated first and the page repeats the stale rotation', async () => {
      const first = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: first.body, raw: true });

      const next = helpers.buildPushSubscription();
      const workerRotation = await helpers.subscribePush({
        payload: { ...next.body, oldEndpoint: first.body.endpoint },
      });
      expect(workerRotation.statusCode).toBe(200);
      expect(workerRotation.body.response.id).toBe(created.id);

      const seenAfterWorker = (await PushSubscriptions.findByPk(created.id))!.lastSeenAt;

      // The page still holds E1; its rotation carries the keys the browser has now.
      const refreshedKeys = helpers.buildPushSubscription();
      const pageRotation = await helpers.subscribePush({
        payload: {
          endpoint: next.body.endpoint,
          keys: refreshedKeys.body.keys,
          deviceLabel: 'Renamed in page',
          oldEndpoint: first.body.endpoint,
        },
      });
      expect(pageRotation.statusCode).toBe(200);
      expect(pageRotation.body.response.id).toBe(created.id);

      const devices = await helpers.listPushDevices({ raw: true });
      expect(devices).toHaveLength(1);
      expect(devices[0]!.deviceLabel).toBe('Renamed in page');

      const row = await PushSubscriptions.findByPk(created.id);
      expect(row!.endpoint).toBe(next.body.endpoint);
      expect(row!.p256dh).toBe(refreshedKeys.body.keys.p256dh);
      expect(row!.auth).toBe(refreshedKeys.body.keys.auth);
      expect(row!.lastSeenAt!.getTime()).toBeGreaterThanOrEqual(seenAfterWorker!.getTime());

      // A third endpoint after the rotation has no row to replace: nothing moves.
      const third = helpers.buildPushSubscription();
      const stale = await helpers.subscribePush({ payload: { ...third.body, oldEndpoint: first.body.endpoint } });
      expect(stale.statusCode).toBe(404);
      expect(errorOf(stale).message).toBe(NOT_FOUND_MESSAGE);
      expect((await PushSubscriptions.findByPk(created.id))!.endpoint).toBe(next.body.endpoint);
      expect(await PushSubscriptions.count({ where: { endpoint: third.body.endpoint } })).toBe(0);
    });

    it('does not recreate a device that was removed', async () => {
      const first = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: first.body, raw: true });
      await helpers.deletePushDevice({ id: created.id });

      const next = helpers.buildPushSubscription();
      const rotated = await helpers.subscribePush({ payload: { ...next.body, oldEndpoint: first.body.endpoint } });

      expect(rotated.statusCode).toBe(404);
      expect(errorOf(rotated).message).toBe(NOT_FOUND_MESSAGE);
      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
      expect(await PushSubscriptions.count()).toBe(0);
    });

    it('does not recreate a device that sync deleted', async () => {
      const first = helpers.buildPushSubscription();
      await helpers.subscribePush({ payload: first.body });

      const other = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: other.cookies,
        // The browser now belongs to the other account, whose sync removes the first user's row.
        fn: () => helpers.syncPushSubscription({ payload: { endpoint: first.body.endpoint } }),
      });
      expect(await PushSubscriptions.count()).toBe(0);

      const next = helpers.buildPushSubscription();
      const rotated = await helpers.subscribePush({ payload: { ...next.body, oldEndpoint: first.body.endpoint } });

      expect(rotated.statusCode).toBe(404);
      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
    });

    it('refuses when the old row is gone and the new endpoint belongs to another user', async () => {
      const first = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: first.body, raw: true });
      await helpers.deletePushDevice({ id: created.id });

      const next = helpers.buildPushSubscription();
      const other = await helpers.signUpSecondUser();
      const otherDevice = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.subscribePush({ payload: next.body, raw: true }),
      });

      const rotated = await helpers.subscribePush({ payload: { ...next.body, oldEndpoint: first.body.endpoint } });

      expect(rotated.statusCode).toBe(404);
      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
      const row = await PushSubscriptions.findByPk(otherDevice.id);
      expect(row!.userId).not.toBe((await Users.findOne({ where: { username: 'test1' } }))!.id);
      expect(row!.endpoint).toBe(next.body.endpoint);
    });

    it('does not touch or enrol anything for the oldEndpoint of another user', async () => {
      const theirs = helpers.buildPushSubscription();
      const other = await helpers.signUpSecondUser();
      const theirDevice = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.subscribePush({ payload: theirs.body, raw: true }),
      });

      const next = helpers.buildPushSubscription();
      const rotated = await helpers.subscribePush({ payload: { ...next.body, oldEndpoint: theirs.body.endpoint } });

      expect(rotated.statusCode).toBe(404);
      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
      expect(await PushSubscriptions.count({ where: { endpoint: next.body.endpoint } })).toBe(0);
      expect((await PushSubscriptions.findByPk(theirDevice.id))!.endpoint).toBe(theirs.body.endpoint);
    });

    it('replaces the caller own row when the new endpoint is also theirs, leaving one row', async () => {
      const first = helpers.buildPushSubscription();
      const second = helpers.buildPushSubscription();
      const firstDevice = await helpers.subscribePush({ payload: first.body, raw: true });
      await helpers.subscribePush({ payload: second.body, raw: true });

      const rotated = await helpers.subscribePush({ payload: { ...second.body, oldEndpoint: first.body.endpoint } });

      expect(rotated.statusCode).toBe(200);
      expect(rotated.body.response.id).toBe(firstDevice.id);
      const devices = await helpers.listPushDevices({ raw: true });
      expect(devices).toHaveLength(1);
      expect(devices[0]!.endpointHash).toBe(endpointHash({ endpoint: second.body.endpoint }));
    });

    it('answers 409 and changes nothing when the new endpoint belongs to another user', async () => {
      const first = helpers.buildPushSubscription();
      const mine = await helpers.subscribePush({ payload: first.body, raw: true });

      const taken = helpers.buildPushSubscription();
      const other = await helpers.signUpSecondUser();
      const theirDevice = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.subscribePush({ payload: taken.body, raw: true }),
      });

      const rotated = await helpers.subscribePush({ payload: { ...taken.body, oldEndpoint: first.body.endpoint } });

      expect(rotated.statusCode).toBe(409);
      expect((await PushSubscriptions.findByPk(mine.id))!.endpoint).toBe(first.body.endpoint);
      const theirRow = await PushSubscriptions.findByPk(theirDevice.id);
      expect(theirRow!.endpoint).toBe(taken.body.endpoint);
      expect(theirRow!.userId).not.toBe((await PushSubscriptions.findByPk(mine.id))!.userId);
    });

    it('answers 422 for a disallowed new host and keeps the old row', async () => {
      const first = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: first.body, raw: true });

      const next = helpers.buildPushSubscription({ host: 'evil.example.com' });
      const rotated = await helpers.subscribePush({ payload: { ...next.body, oldEndpoint: first.body.endpoint } });

      expect(rotated.statusCode).toBe(422);
      expect(errorOf(rotated).message).toBe(ENDPOINT_NOT_ALLOWED_MESSAGE);
      expect((await PushSubscriptions.findByPk(created.id))!.endpoint).toBe(first.body.endpoint);
    });
  });

  describe('POST /push/subscriptions/sync', () => {
    it('knows the caller row and refreshes lastSeenAt', async () => {
      const subscription = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: subscription.body, raw: true });
      await PushSubscriptions.update({ lastSeenAt: new Date('2020-01-01T00:00:00Z') }, { where: { id: created.id } });

      const sync = await helpers.syncPushSubscription({ payload: { endpoint: subscription.body.endpoint }, raw: true });

      expect(sync).toEqual({ known: true });
      const row = await PushSubscriptions.findByPk(created.id);
      expect(row!.lastSeenAt!.getTime()).toBeGreaterThan(new Date('2020-01-01T00:00:00Z').getTime());
    });

    it('answers known false and deletes the row when the endpoint belongs to another user', async () => {
      const subscription = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: subscription.body, raw: true });

      const other = await helpers.signUpSecondUser();
      const sync = await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const result = await helpers.syncPushSubscription({
            payload: { endpoint: subscription.body.endpoint },
            raw: true,
          });
          expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
          return result;
        },
      });

      expect(sync).toEqual({ known: false });
      expect(await PushSubscriptions.findByPk(created.id)).toBeNull();
      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);
    });

    it('answers known false and inserts nothing for an unknown endpoint', async () => {
      const subscription = helpers.buildPushSubscription();

      const sync = await helpers.syncPushSubscription({ payload: { endpoint: subscription.body.endpoint }, raw: true });

      expect(sync).toEqual({ known: false });
      expect(await PushSubscriptions.count()).toBe(0);
    });
  });

  describe('DELETE /push/subscriptions/:id', () => {
    it('removes the device, and a second delete answers 404', async () => {
      const created = await helpers.subscribePush({ payload: helpers.buildPushSubscription().body, raw: true });

      const removed = await helpers.deletePushDevice({ id: created.id });
      expect(removed.statusCode).toBe(200);
      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);

      const again = await helpers.deletePushDevice({ id: created.id });
      expect(again.statusCode).toBe(404);
      expect(errorOf(again).message).toBe(NOT_FOUND_MESSAGE);
    });

    it("answers 404 for another user's device and leaves it in place", async () => {
      const created = await helpers.subscribePush({ payload: helpers.buildPushSubscription().body, raw: true });

      const other = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const response = await helpers.deletePushDevice({ id: created.id });
          expect(response.statusCode).toBe(404);
        },
      });

      expect(await helpers.listPushDevices({ raw: true })).toHaveLength(1);
    });
  });

  describe('POST /push/subscriptions/unsubscribe', () => {
    it('removes the device by endpoint and repeating it still answers 200', async () => {
      const subscription = helpers.buildPushSubscription();
      await helpers.subscribePush({ payload: subscription.body });

      const first = await helpers.unsubscribePush({ payload: { endpoint: subscription.body.endpoint } });
      expect(first.statusCode).toBe(200);
      expect(await helpers.listPushDevices({ raw: true })).toEqual([]);

      const second = await helpers.unsubscribePush({ payload: { endpoint: subscription.body.endpoint } });
      expect(second.statusCode).toBe(200);
    });

    it("never removes another user's device", async () => {
      const subscription = helpers.buildPushSubscription();
      const created = await helpers.subscribePush({ payload: subscription.body, raw: true });

      const other = await helpers.signUpSecondUser();
      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const response = await helpers.unsubscribePush({ payload: { endpoint: subscription.body.endpoint } });
          expect(response.statusCode).toBe(200);
        },
      });

      expect(await PushSubscriptions.findByPk(created.id)).not.toBeNull();
    });
  });

  describe('validation', () => {
    it('rejects a host outside the allowlist, an http endpoint and bad keys with 422', async () => {
      const disallowed = await helpers.subscribePush({
        payload: helpers.buildPushSubscription({ host: 'web.push.apple.com' }).body,
      });
      expect(disallowed.statusCode).toBe(422);
      expect(errorOf(disallowed).message).toBe(ENDPOINT_NOT_ALLOWED_MESSAGE);

      // WHATWG reads this host as attacker.example.push.example.test (allowed); the sender's legacy
      // parser would read `attacker.example`. A percent-encoded host is refused outright.
      const encodedHost = await helpers.subscribePush({
        payload: helpers.buildPushSubscription({ host: 'attacker.example%2epush.example.test' }).body,
      });
      expect(encodedHost.statusCode).toBe(422);
      expect(errorOf(encodedHost).message).toBe(ENDPOINT_NOT_ALLOWED_MESSAGE);

      const plain = helpers.buildPushSubscription();
      const http = await helpers.subscribePush({
        payload: { ...plain.body, endpoint: plain.body.endpoint.replace('https:', 'http:') },
      });
      expect(http.statusCode).toBe(422);
      expect(errorOf(http).message).toBe(ENDPOINT_NOT_ALLOWED_MESSAGE);

      const shortKey = await helpers.subscribePush({
        payload: { ...plain.body, keys: { ...plain.body.keys, p256dh: 'AAAA' } },
      });
      expect(shortKey.statusCode).toBe(422);
      expect(errorOf(shortKey).message).toBe(INVALID_KEYS_MESSAGE);

      const shortAuth = await helpers.subscribePush({
        payload: { ...plain.body, keys: { ...plain.body.keys, auth: 'AAAA' } },
      });
      expect(shortAuth.statusCode).toBe(422);
      expect(errorOf(shortAuth).message).toBe(INVALID_KEYS_MESSAGE);

      const missingAuth = await helpers.subscribePush({
        payload: { endpoint: plain.body.endpoint, keys: { p256dh: plain.body.keys.p256dh } },
      });
      expect(missingAuth.statusCode).toBe(422);
      expect(errorOf(missingAuth).code).toBe(API_ERROR_CODES.validationError);

      expect(await PushSubscriptions.count()).toBe(0);
    });
  });

  describe('access', () => {
    it('blocks a demo user from subscribing', async () => {
      const demo = await helpers.makeAuthRequest({ method: 'post', url: '/demo' });
      expect(demo.statusCode).toBe(200);

      const cookies = helpers.extractCookies(demo);
      const sessionToken = cookies.match(/bt_auth\.session_token=([^;]+)/)?.[1];
      const demoUser = await Users.findByPk(demo.body.response.user.id);
      registerMockSession(sessionToken!, { id: demoUser!.authUserId, email: `demo-${demoUser!.id}@demo.local` });

      try {
        const response = await helpers.asUser({
          cookies,
          fn: () => helpers.subscribePush({ payload: helpers.buildPushSubscription().body }),
        });

        expect(response.statusCode).toBe(403);
        expect(errorOf(response).code).toBe(API_ERROR_CODES.forbidden);
        expect(await PushSubscriptions.count()).toBe(0);
      } finally {
        clearMockSession(sessionToken!);
      }
    }, 120_000);

    it('lets a user on a read-only plan subscribe', async () => {
      await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000) });

      const response = await helpers.subscribePush({ payload: helpers.buildPushSubscription().body });

      expect(response.statusCode).toBe(201);
    });

    it('limits subscribe to 30 requests per minute per user', async () => {
      for (let attempt = 1; attempt <= 30; attempt++) {
        const response = await helpers.subscribePush({ payload: helpers.buildPushSubscription().body });
        expect(response.statusCode).toBe(201);
      }

      const blocked = await helpers.subscribePush({ payload: helpers.buildPushSubscription().body });

      expect(blocked.statusCode).toBe(429);
      expect(errorOf(blocked).code).toBe(API_ERROR_CODES.tooManyRequests);
    }, 120_000);
  });

  describe('data lifecycle', () => {
    it('removes the subscriptions of a deleted account', async () => {
      const other = await helpers.signUpSecondUser();
      const subscription = helpers.buildPushSubscription();

      await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          await helpers.subscribePush({ payload: subscription.body });
          expect(await PushSubscriptions.count({ where: { endpoint: subscription.body.endpoint } })).toBe(1);

          const deletion = await helpers.deleteUserAccount();
          expect(deletion.statusCode).toBe(200);
        },
      });

      expect(await PushSubscriptions.count({ where: { endpoint: subscription.body.endpoint } })).toBe(0);
    });

    it('leaves push subscriptions out of a backup export', async () => {
      const subscription = helpers.buildPushSubscription({ deviceLabel: 'Backup probe device' });
      await helpers.subscribePush({ payload: subscription.body });

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);

      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      for (const [path, content] of archive.files) {
        const text = content.toString('utf8');
        expect({ path, hasEndpoint: text.includes(subscription.body.endpoint) }).toEqual({ path, hasEndpoint: false });
        expect({ path, hasKey: text.includes(subscription.body.keys.p256dh) }).toEqual({ path, hasKey: false });
        expect({ path, hasLabel: text.includes('Backup probe device') }).toEqual({ path, hasLabel: false });
      }
      expect([...archive.files.keys()].some((path) => /push/i.test(path))).toBe(false);
    });
  });
});
