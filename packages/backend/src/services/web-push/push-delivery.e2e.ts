import { NOTIFICATION_TYPES, RESOURCE_TYPES, SHARE_PERMISSIONS, TAG_REMINDER_TYPES } from '@bt/shared/types';
import { until } from '@common/helpers';
import { t } from '@i18n/index';
import { beforeEach, describe, expect, it } from '@jest/globals';
import PushSubscriptions from '@models/push-subscriptions.model';
import { FRONTEND_BASE_URL } from '@root/config';
import * as helpers from '@tests/helpers';
import { clearCapturedPushRequests, getCapturedPushRequests } from '@tests/mocks/web-push/mock-api';
import { generateVAPIDKeys } from 'web-push';

const LONG_TEST_TIMEOUT = 45_000;

const money = ({ locale, amount, currency }: { locale: string; amount: number; currency: string }) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);

/** Registers a device for the active user, as the Enable tap does. */
async function subscribeDevice({ path = 'ok', deviceLabel }: { path?: string; deviceLabel?: string } = {}) {
  const subscription = helpers.buildPushSubscription({ path, deviceLabel });
  const response = await helpers.subscribePush({ payload: subscription.body });
  expect(response.statusCode).toBe(201);
  return { subscription, endpoint: subscription.body.endpoint, device: response.body.response };
}

/**
 * A second user with one working device. Its sentinel push is the barrier for cases whose own
 * device must not receive the sentinel, which the active user's devices all would.
 */
async function setUpBystander() {
  const user = await helpers.provisionSecondUserWithBaseCurrency();
  const device = await helpers.asUser({ cookies: user.cookies, fn: () => subscribeDevice() });

  return {
    ...device,
    awaitSentinel: () =>
      helpers.asUser({
        cookies: user.cookies,
        fn: () => helpers.awaitSentinelPush({ subscription: device.subscription }),
      }),
  };
}

const createReminder = ({
  title = 'Payment reminder: Apple Music',
  message = '"Apple Music" is due on 2026-10-20',
} = {}) =>
  helpers.createNotification({
    payload: {
      type: NOTIFICATION_TYPES.subscriptionReminder,
      title,
      message,
      payload: { subscriptionId: 'sub-1', dueDate: '2026-10-20' },
    },
    raw: true,
  });

const createShareRevoked = () =>
  helpers.createNotification({
    payload: {
      type: NOTIFICATION_TYPES.shareRevoked,
      title: 'Your access was revoked',
      payload: { resourceName: 'Shared wallet', counterpartUser: { id: 1, username: 'owner', avatar: null } },
    },
    raw: true,
  });

const listDevices = () => helpers.listPushDevices({ raw: true });

const storedSubscription = ({ endpoint }: { endpoint: string }) => PushSubscriptions.findOne({ where: { endpoint } });

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

describe('Web Push delivery', () => {
  beforeEach(() => {
    clearCapturedPushRequests();
  });

  describe('happy path', () => {
    it('sends one encrypted Declarative Web Push message for a notification created over HTTP', async () => {
      const { subscription, endpoint } = await subscribeDevice();

      const notification = await createReminder();
      const [request] = await helpers.waitForPushRequests({ count: 1, endpoint });

      expect(request!.headers.ttl).toBe('86400');
      expect(request!.headers.urgency).toBe('normal');
      expect(request!.headers.topic).toBe(notification.id.replaceAll('-', ''));
      expect(request!.headers['content-encoding']).toBe('aes128gcm');
      expect(request!.headers.authorization).toMatch(new RegExp(`^vapid t=\\S+, k=${process.env.VAPID_PUBLIC_KEY}$`));

      expect(helpers.decryptCapturedRequest({ request: request!, subscription })).toEqual({
        web_push: 8030,
        mutable: true,
        notification: {
          title: 'Payment reminder: Apple Music',
          body: '"Apple Music" is due on 2026-10-20',
          navigate: `${FRONTEND_BASE_URL}/notifications/${notification.id}`,
          lang: 'en',
          tag: notification.id,
          silent: false,
          data: {
            v: 1,
            kind: 'notification',
            notificationId: notification.id,
            type: NOTIFICATION_TYPES.subscriptionReminder,
            path: `/notifications/${notification.id}`,
            unreadCount: 1,
          },
        },
      });

      await until(async () => (await listDevices())[0]!.lastSuccessAt !== null, { timeout: 5000, interval: 25 });
      expect((await listDevices())[0]!.failureCount).toBe(0);
    });
  });

  describe('producers driven over HTTP', () => {
    it('pushes a share invitation to the invitee with the counterpart and resource, and not to the owner', async () => {
      const account = await helpers.createAccount({ raw: true });
      const owner = await subscribeDevice();

      const invitee = await helpers.provisionSecondUserWithBaseCurrency();
      const inviteeDevice = await helpers.asUser({ cookies: invitee.cookies, fn: () => subscribeDevice() });

      const invitation = await helpers.createShareInvitation({
        inviteeEmail: invitee.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.read,
      });
      expect(invitation.statusCode).toBe(201);

      const [request] = await helpers.waitForPushRequests({ count: 1, endpoint: inviteeDevice.endpoint });
      const message = helpers.decryptCapturedRequest({ request: request!, subscription: inviteeDevice.subscription });
      expect(message.notification.data.type).toBe(NOTIFICATION_TYPES.shareInvitationReceived);
      expect(message.notification.title).toBe(`test1 shared "${account.name}" with you`);
      expect(message.notification.body).toBe(`@test1 · ${account.name}`);

      const { sentinelId, requests } = await helpers.awaitSentinelPush({ subscription: owner.subscription });
      const ownerRequests = requests.filter((captured) => captured.endpoint === owner.endpoint);
      expect(ownerRequests).toHaveLength(1);
      expect(helpers.notificationIdOf({ request: ownerRequests[0]!, subscription: owner.subscription })).toBe(
        sentinelId,
      );
    });

    it.each([
      { locale: 'en', spent: 'spent', threshold: 'threshold' },
      { locale: 'uk', spent: 'витрачено', threshold: 'поріг' },
    ])('renders the tag reminder amounts for the $locale locale', async ({ locale, spent, threshold }) => {
      await helpers.patchUserSettings({ patch: { locale }, raw: true });
      const { subscription, endpoint } = await subscribeDevice();

      await helpers.createNotification({
        payload: {
          type: NOTIFICATION_TYPES.tagReminder,
          title: 'Tag reminder',
          message: 'stored message that the bell does not show',
          payload: {
            tagId: 'tag-1',
            tagName: 'Groceries',
            reminderType: TAG_REMINDER_TYPES.amountThreshold,
            thresholdAmount: 100,
            actualAmount: 150.5,
            currencyCode: 'USD',
          },
        },
        raw: true,
      });

      const [request] = await helpers.waitForPushRequests({ count: 1, endpoint });
      const { notification } = helpers.decryptCapturedRequest({ request: request!, subscription });

      expect(notification.lang).toBe(locale);
      expect(notification.body).toBe(
        `Groceries · ${spent} ${money({ locale, amount: 150.5, currency: 'USD' })} (${threshold}: ${money({ locale, amount: 100, currency: 'USD' })})`,
      );
    });
  });

  describe('devices', () => {
    it('sends one request per device of the user and none to another user', async () => {
      const first = await subscribeDevice();
      const second = await subscribeDevice();

      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const otherDevice = await helpers.asUser({ cookies: other.cookies, fn: () => subscribeDevice() });

      const notification = await createReminder();
      await helpers.waitForPushRequests({ count: 1, endpoint: first.endpoint });
      await helpers.waitForPushRequests({ count: 1, endpoint: second.endpoint });

      const { sentinelId, requests } = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.awaitSentinelPush({ subscription: otherDevice.subscription }),
      });

      expect(requests.filter((request) => request.endpoint === first.endpoint)).toHaveLength(1);
      expect(requests.filter((request) => request.endpoint === second.endpoint)).toHaveLength(1);
      expect(helpers.notificationIdOf({ request: requests[0]!, subscription: first.subscription })).toBe(
        notification.id,
      );

      const otherRequests = requests.filter((request) => request.endpoint === otherDevice.endpoint);
      expect(otherRequests).toHaveLength(1);
      expect(helpers.notificationIdOf({ request: otherRequests[0]!, subscription: otherDevice.subscription })).toBe(
        sentinelId,
      );
    });
  });

  describe('preferences', () => {
    it('sends nothing for a group the user turned off and still pushes another group', async () => {
      const { subscription, endpoint } = await subscribeDevice();
      await helpers.patchUserSettings({
        patch: { notifications: { push: { groups: { reminders: false } } } },
        raw: true,
      });

      await createReminder();
      const sharing = await createShareRevoked();
      const { sentinelId, requests } = await helpers.awaitSentinelPush({ subscription });

      const sentIds = requests
        .filter((request) => request.endpoint === endpoint)
        .map((request) => helpers.notificationIdOf({ request, subscription }));
      expect(sentIds).toEqual([sharing.id, sentinelId]);
    });

    it('does not push a release by default and pushes it in the user locale once the releases group is on', async () => {
      const { subscription, endpoint } = await subscribeDevice();

      const first = await helpers.sendGitHubWebhook({
        payload: helpers.createReleasePayload({ tagName: 'v3.0.0', name: 'Autumn release' }),
      });
      expect(first.body.notifiedUsers).toBe(1);

      const { sentinelId, requests } = await helpers.awaitSentinelPush({ subscription });
      expect(requests.map((request) => helpers.notificationIdOf({ request, subscription }))).toEqual([sentinelId]);

      await helpers.patchUserSettings({
        patch: { locale: 'uk', notifications: { push: { groups: { releases: true } } } },
        raw: true,
      });
      const second = await helpers.sendGitHubWebhook({
        payload: helpers.createReleasePayload({ tagName: 'v3.1.0', name: 'Winter release' }),
      });
      expect(second.body.notifiedUsers).toBe(1);

      const delivered = await helpers.waitForPushRequests({ count: 2, endpoint });
      const { notification } = helpers.decryptCapturedRequest({ request: delivered[1]!, subscription });
      expect(notification.title).toBe(t({ key: 'webPush.newVersion', variables: { version: 'v3.1.0' }, locale: 'uk' }));
      expect(notification.title).toContain('v3.1.0');
      expect(notification.body).toBe('Winter release');
      expect(notification.lang).toBe('uk');
      expect(notification.data.type).toBe(NOTIFICATION_TYPES.changelog);
    });
  });

  describe('guards at delivery time', () => {
    it(
      'sends nothing on the retry once the user read the notification',
      async () => {
        const held = await subscribeDevice({ path: 'hold' });
        const bystander = await setUpBystander();

        const notification = await createReminder();
        await helpers.waitForPushRequests({ count: 1, endpoint: held.endpoint });

        // The mock is still holding the first request, so the read lands between the attempt and its retry.
        await helpers.markAsRead({ id: notification.id, raw: true });
        const { sentinelId, requests } = await bystander.awaitSentinel();

        expect(requests.filter((request) => request.endpoint === held.endpoint)).toHaveLength(1);
        const bystanderRequests = requests.filter((request) => request.endpoint === bystander.endpoint);
        expect(bystanderRequests).toHaveLength(1);
        expect(helpers.notificationIdOf({ request: bystanderRequests[0]!, subscription: bystander.subscription })).toBe(
          sentinelId,
        );
      },
      LONG_TEST_TIMEOUT,
    );

    it(
      'sends nothing on the retry once the device belongs to another account',
      async () => {
        const held = await subscribeDevice({ path: 'hold' });
        const newOwner = await helpers.provisionSecondUserWithBaseCurrency();
        const bystander = await setUpBystander();

        await createReminder();
        await helpers.waitForPushRequests({ count: 1, endpoint: held.endpoint });

        // Enable on the same endpoint moves the row to the new account under the same id.
        const moved = await helpers.asUser({
          cookies: newOwner.cookies,
          fn: () =>
            helpers.subscribePush({
              payload: { ...held.subscription.body, keys: helpers.buildPushSubscription().body.keys },
            }),
        });
        expect(moved.statusCode).toBe(200);

        const { requests } = await bystander.awaitSentinel();

        expect(requests.filter((request) => request.endpoint === held.endpoint)).toHaveLength(1);
        expect(await listDevices()).toEqual([]);
      },
      LONG_TEST_TIMEOUT,
    );
  });

  describe('push service answers', () => {
    it.each(['gone', 'missing'])('removes a device whose endpoint answers /%s/', async (path) => {
      const { endpoint } = await subscribeDevice({ path });

      await createReminder();
      await helpers.waitForPushRequests({ count: 1, endpoint });

      await until(async () => (await listDevices()).length === 0, { timeout: 5000, interval: 25 });
    });

    it('retries a transient failure per device until it succeeds', async () => {
      const { endpoint } = await subscribeDevice({ path: 'flaky' });

      await createReminder();
      await helpers.waitForPushRequests({ count: 3, endpoint });

      await until(async () => (await listDevices())[0]?.lastSuccessAt !== null, { timeout: 5000, interval: 25 });
      expect(getCapturedPushRequests({ endpoint })).toHaveLength(3);
      expect(await listDevices()).toHaveLength(1);
    });

    it('retries a 429 once', async () => {
      const { endpoint } = await subscribeDevice({ path: 'rate' });

      await createReminder();
      await helpers.waitForPushRequests({ count: 2, endpoint });

      await until(async () => (await listDevices())[0]?.lastSuccessAt !== null, { timeout: 5000, interval: 25 });
    });

    it('does not retry a 400 and counts it against the device', async () => {
      const bad = await subscribeDevice({ path: 'bad' });
      const bystander = await setUpBystander();

      await createReminder();
      await helpers.waitForPushRequests({ count: 1, endpoint: bad.endpoint });
      const { requests } = await bystander.awaitSentinel();

      expect(requests.filter((request) => request.endpoint === bad.endpoint)).toHaveLength(1);
      await until(async () => (await listDevices()).some((device) => device.failureCount === 1), {
        timeout: 5000,
        interval: 25,
      });
    });

    it('never counts or prunes for an instance-side refusal', async () => {
      const refused = await subscribeDevice({ path: 'forbidden' });
      const bystander = await setUpBystander();

      for (let index = 1; index <= 3; index += 1) {
        await createReminder({ title: `Reminder ${index}` });
        await helpers.waitForPushRequests({ count: index, endpoint: refused.endpoint });
      }
      const { requests } = await bystander.awaitSentinel();

      expect(requests.filter((request) => request.endpoint === refused.endpoint)).toHaveLength(3);
      const stored = await storedSubscription({ endpoint: refused.endpoint });
      expect(stored).not.toBeNull();
      expect(stored!.failureCount).toBe(0);
      expect(stored!.lastFailureStatus).toBe(403);
      expect(stored!.lastFailureAt).not.toBeNull();
      expect(await listDevices()).toHaveLength(1);
    });

    it('records an exhausted 5xx retry without counting it or removing the device', async () => {
      const down = await subscribeDevice({ path: 'down' });
      const bystander = await setUpBystander();

      await createReminder();
      await helpers.waitForPushRequests({ count: 5, endpoint: down.endpoint });
      const { requests } = await bystander.awaitSentinel();

      expect(requests.filter((request) => request.endpoint === down.endpoint)).toHaveLength(5);
      await until(async () => (await storedSubscription({ endpoint: down.endpoint }))?.lastFailureAt != null, {
        timeout: 5000,
        interval: 25,
      });
      const stored = await storedSubscription({ endpoint: down.endpoint });
      expect(stored!.failureCount).toBe(0);
      expect(stored!.lastFailureStatus).toBe(500);
      expect(await listDevices()).toHaveLength(1);
    });

    it(
      'removes a device after ten consecutive rejections',
      async () => {
        const { endpoint } = await subscribeDevice({ path: 'bad' });

        for (let rejection = 1; rejection <= 9; rejection += 1) {
          await createReminder({ title: `Reminder ${rejection}` });
          await until(async () => (await listDevices())[0]?.failureCount === rejection, {
            timeout: 5000,
            interval: 25,
          });
        }
        expect(getCapturedPushRequests({ endpoint })).toHaveLength(9);

        await createReminder({ title: 'Reminder 10' });
        await until(async () => (await listDevices()).length === 0, { timeout: 5000, interval: 25 });
        expect(getCapturedPushRequests({ endpoint })).toHaveLength(10);
      },
      LONG_TEST_TIMEOUT,
    );

    it('resets the rejection count on a successful send', async () => {
      const { endpoint } = await subscribeDevice({ path: 'bad-once' });

      await createReminder({ title: 'Rejected' });
      await until(async () => (await listDevices())[0]?.failureCount === 1, { timeout: 5000, interval: 25 });

      await createReminder({ title: 'Accepted' });
      await helpers.waitForPushRequests({ count: 2, endpoint });
      await until(async () => (await listDevices())[0]?.failureCount === 0, { timeout: 5000, interval: 25 });
      expect((await listDevices())[0]!.lastSuccessAt).not.toBeNull();
    });
  });

  describe('instance configuration', () => {
    it('removes a device subscribed under another VAPID key without sending to it', async () => {
      const stale = await subscribeDevice();

      const saved = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
      const next = generateVAPIDKeys();
      process.env.VAPID_PUBLIC_KEY = next.publicKey;
      process.env.VAPID_PRIVATE_KEY = next.privateKey;
      try {
        const current = await subscribeDevice();

        await createReminder();
        await helpers.waitForPushRequests({ count: 1, endpoint: current.endpoint });
        await until(async () => (await listDevices()).length === 1, { timeout: 5000, interval: 25 });

        expect(getCapturedPushRequests({ endpoint: stale.endpoint })).toHaveLength(0);
      } finally {
        process.env.VAPID_PUBLIC_KEY = saved.publicKey;
        process.env.VAPID_PRIVATE_KEY = saved.privateKey;
      }
    });

    it('creates notifications while the feature is off and queues nothing for them', async () => {
      const { subscription } = await subscribeDevice();

      await withVapidCleared(async () => {
        const response = await helpers.createNotification({
          payload: { type: NOTIFICATION_TYPES.system, title: 'Created while off' },
        });
        expect(response.statusCode).toBe(200);
      });

      const { sentinelId, requests } = await helpers.awaitSentinelPush({ subscription });
      expect(requests.map((request) => helpers.notificationIdOf({ request, subscription }))).toEqual([sentinelId]);
    });
  });
});
