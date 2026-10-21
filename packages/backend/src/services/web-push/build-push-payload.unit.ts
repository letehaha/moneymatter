import { NOTIFICATION_TYPES, type NotificationType, type RecordId } from '@bt/shared/types';
import { i18nextReady } from '@i18n/index';
import { beforeAll, describe, expect, it } from '@jest/globals';

import { buildPushPayload, buildTestPushPayload } from './build-push-payload';

type PayloadNotification = Parameters<typeof buildPushPayload>[0]['notification'];

const ID = '7c0e1a52-3b9d-4c1e-8f4a-0a1b2c3d4e5f' as RecordId;
const ORIGIN = 'https://money.example.com';
const MAX_PAYLOAD_BYTES = 3000;

const notification = (overrides: Partial<PayloadNotification> = {}): PayloadNotification => ({
  id: ID,
  type: NOTIFICATION_TYPES.subscriptionReminder,
  title: 'Payment reminder: Apple Music',
  message: '"Apple Music" is due on 2026-10-20',
  payload: {},
  ...overrides,
});

const byteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

describe('buildPushPayload', () => {
  beforeAll(async () => {
    await i18nextReady;
  });

  it('builds the exact declarative payload with top-level mutable: true', () => {
    const payload = buildPushPayload({ notification: notification(), locale: 'en', origin: ORIGIN, unreadCount: 3 });

    expect(payload).toEqual({
      web_push: 8030,
      mutable: true,
      notification: {
        title: 'Payment reminder: Apple Music',
        body: '"Apple Music" is due on 2026-10-20',
        navigate: `${ORIGIN}/notifications/${ID}`,
        lang: 'en',
        tag: ID,
        silent: false,
        data: {
          v: 1,
          kind: 'notification',
          notificationId: ID,
          type: 'subscription_reminder',
          path: `/notifications/${ID}`,
          unreadCount: 3,
        },
      },
    });
  });

  it('puts mutable next to web_push, not inside the notification', () => {
    const payload = buildPushPayload({ notification: notification(), locale: 'en', origin: ORIGIN, unreadCount: 0 });
    expect(payload.mutable).toBe(true);
    expect(payload.notification).not.toHaveProperty('mutable');
  });

  it('joins origin and path with a single slash', () => {
    const payload = buildPushPayload({ notification: notification(), locale: 'en', origin: ORIGIN, unreadCount: 1 });
    expect(payload.notification.navigate).toBe(`https://money.example.com/notifications/${ID}`);
    expect(payload.notification.navigate).not.toContain('com//');
  });

  it('uses the notification id as tag', () => {
    const payload = buildPushPayload({ notification: notification(), locale: 'en', origin: ORIGIN, unreadCount: 1 });
    expect(payload.notification.tag).toBe(ID);
  });

  it('passes the user locale as lang', () => {
    const payload = buildPushPayload({ notification: notification(), locale: 'uk', origin: ORIGIN, unreadCount: 1 });
    expect(payload.notification.lang).toBe('uk');
  });

  it('builds the changelog title in uk from the version and uses the release name as the body', () => {
    const changelog = notification({
      type: NOTIFICATION_TYPES.changelog,
      title: 'New version v1.2.0',
      message: null,
      payload: { version: 'v1.2.0', releaseName: 'Autumn release' },
    });

    const uk = buildPushPayload({ notification: changelog, locale: 'uk', origin: ORIGIN, unreadCount: 1 });
    expect(uk.notification.title).toBe('Нова версія v1.2.0');
    expect(uk.notification.body).toBe('Autumn release');

    const en = buildPushPayload({ notification: changelog, locale: 'en', origin: ORIGIN, unreadCount: 1 });
    expect(en.notification.title).toBe('New version v1.2.0');
  });

  it('keeps the stored changelog title when the payload has no version', () => {
    const payload = buildPushPayload({
      notification: notification({
        type: NOTIFICATION_TYPES.changelog,
        title: 'New version v9',
        message: null,
        payload: {},
      }),
      locale: 'uk',
      origin: ORIGIN,
      unreadCount: 1,
    });
    expect(payload.notification.title).toBe('New version v9');
  });

  it('omits the body key when the renderer gives no body', () => {
    const payload = buildPushPayload({
      notification: notification({ type: NOTIFICATION_TYPES.plannedConfirmed, message: null }),
      locale: 'en',
      origin: ORIGIN,
      unreadCount: 1,
    });
    expect(payload.notification).not.toHaveProperty('body');
  });

  it('renders the body through the per-type renderer', () => {
    const payload = buildPushPayload({
      notification: notification({
        type: NOTIFICATION_TYPES.shareAccepted,
        title: 'carol accepted your invitation',
        message: 'stored message',
        payload: { counterpartUser: { id: 3, username: 'carol', avatar: null }, resourceName: 'Main account' },
      }),
      locale: 'en',
      origin: ORIGIN,
      unreadCount: 1,
    });
    expect(payload.notification.body).toBe('@carol · Main account');
  });

  it('falls back to a generic title when the stored title is blank', () => {
    const payload = buildPushPayload({
      notification: notification({ title: '   ' }),
      locale: 'en',
      origin: ORIGIN,
      unreadCount: 1,
    });
    expect(payload.notification.title).toBe('MoneyMatter');
  });

  it('caps the title at 200 characters', () => {
    const payload = buildPushPayload({
      notification: notification({ title: 'a'.repeat(300) }),
      locale: 'en',
      origin: ORIGIN,
      unreadCount: 1,
    });
    expect(Array.from(payload.notification.title).length).toBeLessThanOrEqual(200);
    expect(payload.notification.title.endsWith('…')).toBe(true);
  });

  it('trims a 600-character Cyrillic body by code points with an ellipsis', () => {
    const payload = buildPushPayload({
      notification: notification({ message: 'я'.repeat(600) }),
      locale: 'uk',
      origin: ORIGIN,
      unreadCount: 1,
    });

    const body = payload.notification.body!;
    expect(Array.from(body).length).toBeLessThanOrEqual(500);
    expect(body.endsWith('…')).toBe(true);
    expect(body.startsWith('яяя')).toBe(true);
    expect(byteLength(payload)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
  });

  it('leaves a body under the cap untouched', () => {
    const payload = buildPushPayload({
      notification: notification({ message: 'я'.repeat(500) }),
      locale: 'uk',
      origin: ORIGIN,
      unreadCount: 1,
    });
    expect(payload.notification.body).toBe('я'.repeat(500));
  });

  it('keeps the serialized payload under 3000 bytes for a long emoji title and body, and never splits an emoji', () => {
    const payload = buildPushPayload({
      notification: notification({ title: '😀'.repeat(200), message: '👨‍👩‍👧‍👦'.repeat(100) }),
      locale: 'en',
      origin: ORIGIN,
      unreadCount: 12,
    });

    expect(byteLength(payload)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);

    const body = payload.notification.body!;
    expect(body.endsWith('…')).toBe(true);
    // A split surrogate pair or a cut ZWJ sequence would leave a lone half behind.
    expect(body).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(body.replace('…', '')).toMatch(/^(?:👨‍👩‍👧‍👦)+$/u);
  });

  it('drops the body rather than exceed the cap when nothing of it fits', () => {
    const payload = buildPushPayload({
      notification: notification({ title: '😀'.repeat(200), message: 'x'.repeat(50) }),
      locale: 'en',
      origin: `https://${'a'.repeat(1800)}.example.com`,
      unreadCount: 1,
    });
    expect(payload.notification).not.toHaveProperty('body');
  });

  it('keeps a one-character body', () => {
    const payload = buildPushPayload({
      notification: notification({ message: 'x' }),
      locale: 'en',
      origin: ORIGIN,
      unreadCount: 1,
    });
    expect(payload.notification.body).toBe('x');
  });

  it('accepts every notification type', () => {
    for (const type of Object.values(NOTIFICATION_TYPES) as NotificationType[]) {
      const payload = buildPushPayload({
        notification: notification({ type }),
        locale: 'en',
        origin: ORIGIN,
        unreadCount: 1,
      });
      expect(payload.notification.data.type).toBe(type);
    }
  });
});

describe('buildTestPushPayload', () => {
  beforeAll(async () => {
    await i18nextReady;
  });

  it('builds a test message with its own kind, tag and path', () => {
    const payload = buildTestPushPayload({ locale: 'en', origin: ORIGIN });

    expect(payload).toEqual({
      web_push: 8030,
      mutable: true,
      notification: {
        title: 'MoneyMatter',
        body: 'Browser notifications are working on this device.',
        navigate: `${ORIGIN}/settings/notifications`,
        lang: 'en',
        tag: 'push-test',
        silent: false,
        data: { v: 1, kind: 'test', path: '/settings/notifications', unreadCount: 0 },
      },
    });
  });

  it('translates the body and carries the given unread count', () => {
    const payload = buildTestPushPayload({ locale: 'uk', origin: ORIGIN, unreadCount: 4 });
    expect(payload.notification.body).toBe('Сповіщення в браузері працюють на цьому пристрої.');
    expect(payload.notification.lang).toBe('uk');
    expect(payload.notification.data.unreadCount).toBe(4);
  });
});
