import { NOTIFICATION_PRIORITIES, NOTIFICATION_STATUSES, NOTIFICATION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const LINK = 'https://www.reddit.com/r/moneymatterapp/comments/abc/ios_beta/';

const getSystemNotifications = () => helpers.getNotifications({ type: NOTIFICATION_TYPES.system, raw: true });

describe('Admin broadcast notification (POST /admin/notifications/broadcast)', () => {
  let originalAdminUsers: string | undefined;

  beforeEach(() => {
    originalAdminUsers = process.env.ADMIN_USERS;
  });

  afterEach(() => {
    if (originalAdminUsers === undefined) delete process.env.ADMIN_USERS;
    else process.env.ADMIN_USERS = originalAdminUsers;
  });

  it('rejects a non-admin caller', async () => {
    process.env.ADMIN_USERS = 'someone-else';

    const res = await helpers.adminBroadcastNotification({ payload: { title: 'Hello' } });
    expect(res.statusCode).toBe(401);
    expect(await getSystemNotifications()).toHaveLength(0);
  });

  it('rejects an unauthenticated caller', async () => {
    process.env.ADMIN_USERS = 'test1';

    const res = await helpers.withoutSession(() => helpers.adminBroadcastNotification({ payload: { title: 'Hello' } }));
    expect(res.statusCode).toBe(401);
  });

  describe('as an admin', () => {
    beforeEach(() => {
      process.env.ADMIN_USERS = 'test1';
    });

    it('creates an unread system notification for each active user', async () => {
      const result = await helpers.adminBroadcastNotification({
        payload: { title: 'iOS app is in public beta', message: 'Tap for details.', url: LINK, icon: 'announcement' },
        raw: true,
      });
      expect(result).toEqual({ created: 1 });

      const notifications = await getSystemNotifications();
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({
        title: 'iOS app is in public beta',
        message: 'Tap for details.',
        payload: { url: LINK, icon: 'announcement' },
        status: NOTIFICATION_STATUSES.unread,
        priority: NOTIFICATION_PRIORITIES.normal,
      });
    });

    it('skips users who already got a notification with the same url', async () => {
      await helpers.adminBroadcastNotification({ payload: { title: 'First', url: LINK }, raw: true });
      const second = await helpers.adminBroadcastNotification({ payload: { title: 'Again', url: LINK }, raw: true });
      expect(second).toEqual({ created: 0 });

      const otherUrl = await helpers.adminBroadcastNotification({
        payload: { title: 'Other', url: `${LINK}other` },
        raw: true,
      });
      expect(otherUrl).toEqual({ created: 1 });
      expect(await getSystemNotifications()).toHaveLength(2);
    });

    it('does not dedupe broadcasts without a url', async () => {
      await helpers.adminBroadcastNotification({ payload: { title: 'One' }, raw: true });
      await helpers.adminBroadcastNotification({ payload: { title: 'Two' }, raw: true });
      expect(await getSystemNotifications()).toHaveLength(2);
    });

    it('sends only to the given user ids, ignoring unknown ones', async () => {
      const second = await helpers.signUpSecondUser();
      const { id } = await helpers.getUserInfo({ raw: true });

      const result = await helpers.adminBroadcastNotification({
        payload: { title: 'Just you', url: LINK, userIds: [id, 999_999] },
        raw: true,
      });
      expect(result).toEqual({ created: 1 });
      expect(await getSystemNotifications()).toHaveLength(1);
      expect(await helpers.asUser({ cookies: second.cookies, fn: getSystemNotifications })).toHaveLength(0);

      const again = await helpers.adminBroadcastNotification({
        payload: { title: 'Just you', url: LINK, userIds: [id] },
        raw: true,
      });
      expect(again).toEqual({ created: 0 });
    });

    it('sends to the given emails case-insensitively, combined with user ids', async () => {
      const second = await helpers.signUpSecondUser({ email: 'second.user@test.local' });
      const { id } = await helpers.getUserInfo({ raw: true });

      const result = await helpers.adminBroadcastNotification({
        payload: { title: 'By email', userIds: [id], emails: ['Second.User@test.local', 'nobody@test.local'] },
        raw: true,
      });
      expect(result).toEqual({ created: 2 });
      expect(await helpers.asUser({ cookies: second.cookies, fn: getSystemNotifications })).toHaveLength(1);
    });

    it('creates nothing when no given user exists', async () => {
      const result = await helpers.adminBroadcastNotification({
        payload: { title: 'Nobody', userIds: [999_999], emails: ['nobody@test.local'] },
        raw: true,
      });
      expect(result).toEqual({ created: 0 });
    });

    it('leaves out users without a recent session by default', async () => {
      const inactive = await helpers.signUpSecondUser();

      const result = await helpers.adminBroadcastNotification({ payload: { title: 'Active only' }, raw: true });
      expect(result).toEqual({ created: 1 });
      expect(await helpers.asUser({ cookies: inactive.cookies, fn: getSystemNotifications })).toHaveLength(0);
    });

    it('counts a user matched by both id and email once, and dedupes per user', async () => {
      const second = await helpers.signUpSecondUser({ email: 'both@test.local' });
      const { id: secondId } = await helpers.asUser({
        cookies: second.cookies,
        fn: () => helpers.getUserInfo({ raw: true }),
      });
      const { id } = await helpers.getUserInfo({ raw: true });

      const first = await helpers.adminBroadcastNotification({
        payload: { title: 'Both', url: LINK, userIds: [secondId], emails: ['both@test.local'] },
        raw: true,
      });
      expect(first).toEqual({ created: 1 });

      const overlap = await helpers.adminBroadcastNotification({
        payload: { title: 'Both', url: LINK, userIds: [id, secondId] },
        raw: true,
      });
      expect(overlap).toEqual({ created: 1 });
      expect(await helpers.asUser({ cookies: second.cookies, fn: getSystemNotifications })).toHaveLength(1);
    });

    it('creates a notification without url or message', async () => {
      const result = await helpers.adminBroadcastNotification({
        payload: { title: '  Plain  ', message: '   ' },
        raw: true,
      });
      expect(result).toEqual({ created: 1 });

      const [notification] = await getSystemNotifications();
      expect(notification).toMatchObject({ title: 'Plain', message: null, payload: {} });
    });

    it.each([
      ['empty title', { title: '   ' }],
      ['http url', { title: 'Bad', url: 'http://example.com' }],
      ['javascript url', { title: 'Bad', url: 'javascript:alert(1)' }],
      ['invalid url', { title: 'Bad', url: 'not a url' }],
      ['empty userIds', { title: 'Bad', userIds: [] }],
      ['zero user id', { title: 'Bad', userIds: [0] }],
      ['fractional user id', { title: 'Bad', userIds: [1.5] }],
      ['invalid email', { title: 'Bad', emails: ['not-an-email'] }],
      ['unknown field', { title: 'Bad', foo: 1 }],
      ['unknown icon', { title: 'Bad', icon: 'rocket' }],
      ['too long title', { title: 'a'.repeat(201) }],
      ['too long message', { title: 'Bad', message: 'a'.repeat(1001) }],
      ['user id out of integer range', { title: 'Bad', userIds: [2_147_483_648] }],
    ])('rejects %s', async (_, payload) => {
      const res = await helpers.adminBroadcastNotification({ payload: payload as never });
      expect(res.statusCode).toBe(422);
    });
  });
});
