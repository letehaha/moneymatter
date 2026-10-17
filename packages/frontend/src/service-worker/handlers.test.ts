import { describe, expect, it, vi } from 'vitest';

import {
  FALLBACK_BODY,
  FALLBACK_TITLE,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  type ServiceWorkerClientLike,
  announceEndpointChange,
  buildResubscribeRequest,
  handleNotificationClick,
  handlePush,
  handleSubscriptionChange,
  parsePushEvent,
  postClickWithAck,
  resolveClickAction,
} from './handlers';

const ORIGIN = 'https://money.example.com';

const NOTIFICATION_DATA = {
  v: 1,
  kind: 'notification',
  notificationId: '7c0e0000-0000-4000-8000-000000000001',
  type: 'subscription_reminder',
  path: '/notifications/7c0e0000-0000-4000-8000-000000000001',
  unreadCount: 3,
};

const declarativeJson = ({ title = 'Payment reminder: Apple Music' }: { title?: string } = {}) =>
  JSON.stringify({
    web_push: 8030,
    mutable: true,
    notification: {
      title,
      body: '"Apple Music" is due on 2026-10-20',
      navigate: `${ORIGIN}${NOTIFICATION_DATA.path}`,
      lang: 'en',
      tag: NOTIFICATION_DATA.notificationId,
      silent: false,
      data: NOTIFICATION_DATA,
    },
  });

const makeClient = (overrides: Partial<ServiceWorkerClientLike> = {}): ServiceWorkerClientLike => ({
  url: `${ORIGIN}/dashboard`,
  focused: false,
  visibilityState: 'hidden',
  focus: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  postMessage: vi.fn(),
  ...overrides,
});

describe('parsePushEvent', () => {
  it('reads a declarative event from event.notification, with no event.data', () => {
    const result = parsePushEvent({
      notification: {
        title: 'Payment reminder: Apple Music',
        body: '"Apple Music" is due on 2026-10-20',
        tag: NOTIFICATION_DATA.notificationId,
        lang: 'en',
        data: NOTIFICATION_DATA,
      },
      dataText: null,
    });

    expect(result).toEqual({
      title: 'Payment reminder: Apple Music',
      options: {
        body: '"Apple Music" is due on 2026-10-20',
        tag: NOTIFICATION_DATA.notificationId,
        lang: 'en',
        data: NOTIFICATION_DATA,
        icon: NOTIFICATION_ICON,
        badge: NOTIFICATION_BADGE,
      },
    });
    expect(result.options.data).toMatchObject({ path: NOTIFICATION_DATA.path, unreadCount: 3 });
    expect(result.title).not.toBe(FALLBACK_TITLE);
  });

  it('reads fields off prototype getters, like a real Notification object', () => {
    class FakeNotification {
      get title() {
        return 'From getter';
      }
      get body() {
        return 'Body getter';
      }
      get tag() {
        return 'tag-1';
      }
      get lang() {
        return 'uk';
      }
      get data() {
        return NOTIFICATION_DATA;
      }
    }

    const result = parsePushEvent({ notification: new FakeNotification(), dataText: null });

    expect(result.title).toBe('From getter');
    expect(result.options).toMatchObject({ body: 'Body getter', tag: 'tag-1', lang: 'uk', data: NOTIFICATION_DATA });
  });

  it('parses a declarative JSON from event.data when there is no event.notification', () => {
    const result = parsePushEvent({ notification: undefined, dataText: declarativeJson() });

    expect(result.title).toBe('Payment reminder: Apple Music');
    expect(result.options).toEqual({
      body: '"Apple Music" is due on 2026-10-20',
      tag: NOTIFICATION_DATA.notificationId,
      lang: 'en',
      data: NOTIFICATION_DATA,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
    });
  });

  it('ignores the declarative-only top-level keys', () => {
    const result = parsePushEvent({ notification: null, dataText: declarativeJson() });

    expect(result.options).not.toHaveProperty('web_push');
    expect(result.options).not.toHaveProperty('mutable');
    expect(result.options.data).not.toHaveProperty('web_push');
  });

  it('accepts a bare { title, body } JSON', () => {
    const result = parsePushEvent({ notification: null, dataText: JSON.stringify({ title: 'Hello', body: 'World' }) });

    expect(result.title).toBe('Hello');
    expect(result.options.body).toBe('World');
    expect(result.options.icon).toBe(NOTIFICATION_ICON);
  });

  it.each([
    ['plain text', 'just text'],
    ['empty data', ''],
    ['null data', null],
    ['invalid JSON', '{"title": '],
    ['a JSON without a title', JSON.stringify({ body: 'No title' })],
    ['a JSON array', '[1, 2]'],
    ['a JSON scalar', '42'],
  ])('falls back to the generic text for %s', (_label, dataText) => {
    const result = parsePushEvent({ notification: undefined, dataText });

    expect(result.title).toBe(FALLBACK_TITLE);
    expect(result.options.body).toBe(FALLBACK_BODY);
    expect(result.options.icon).toBe(NOTIFICATION_ICON);
  });

  it('falls back to dataText when the notification has an empty title', () => {
    const result = parsePushEvent({ notification: { title: '', body: 'x' }, dataText: declarativeJson() });

    expect(result.title).toBe('Payment reminder: Apple Music');
  });

  it('falls back to the generic text when the notification title is empty and dataText is unusable', () => {
    const result = parsePushEvent({ notification: { title: '   ' }, dataText: 'nope' });

    expect(result.title).toBe(FALLBACK_TITLE);
    expect(result.options.body).toBe(FALLBACK_BODY);
  });

  it('omits an empty body, tag and lang instead of passing empty strings', () => {
    const result = parsePushEvent({ notification: { title: 'T', body: '', tag: '', lang: '' }, dataText: null });

    expect(result.options).not.toHaveProperty('body');
    expect(result.options).not.toHaveProperty('tag');
    expect(result.options).not.toHaveProperty('lang');
  });
});

describe('handlePush', () => {
  it('shows the notification and sets the badge from the unread count', async () => {
    const show = vi.fn().mockResolvedValue(undefined);
    const setBadge = vi.fn().mockResolvedValue(undefined);

    await handlePush({
      notification: { title: 'T', data: { unreadCount: 4 } },
      dataText: null,
      show,
      setBadge,
    });

    expect(show).toHaveBeenCalledWith({ title: 'T', options: expect.objectContaining({ data: { unreadCount: 4 } }) });
    expect(setBadge).toHaveBeenCalledWith({ count: 4 });
  });

  it('shows the generic notification for an unreadable payload and skips the badge', async () => {
    const show = vi.fn().mockResolvedValue(undefined);
    const setBadge = vi.fn();

    await handlePush({ notification: undefined, dataText: 'garbage', show, setBadge });

    expect(show).toHaveBeenCalledWith({ title: FALLBACK_TITLE, options: expect.any(Object) });
    expect(setBadge).not.toHaveBeenCalled();
  });

  it('still resolves when the badge call fails, after showing the notification', async () => {
    const show = vi.fn().mockResolvedValue(undefined);
    const setBadge = vi.fn().mockRejectedValue(new Error('no badge'));

    await expect(
      handlePush({ notification: { title: 'T', data: { unreadCount: 1 } }, dataText: null, show, setBadge }),
    ).resolves.toBeUndefined();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('works without a badge function', async () => {
    const show = vi.fn().mockResolvedValue(undefined);

    await handlePush({ notification: { title: 'T', data: { unreadCount: 1 } }, dataText: null, show });

    expect(show).toHaveBeenCalledTimes(1);
  });
});

describe('resolveClickAction', () => {
  it('focuses a same-origin window and builds the click message', () => {
    const client = makeClient();

    const action = resolveClickAction({ data: NOTIFICATION_DATA, origin: ORIGIN, clients: [client] });

    expect(action).toEqual({
      focus: client,
      message: {
        type: 'notification-click',
        notificationId: NOTIFICATION_DATA.notificationId,
        path: NOTIFICATION_DATA.path,
      },
      fallbackUrl: `${ORIGIN}${NOTIFICATION_DATA.path}`,
    });
  });

  it('prefers a focused client, then a visible one', () => {
    const hidden = makeClient({ url: `${ORIGIN}/a` });
    const visible = makeClient({ url: `${ORIGIN}/b`, visibilityState: 'visible' });
    const focused = makeClient({ url: `${ORIGIN}/c`, focused: true, visibilityState: 'visible' });

    expect(
      resolveClickAction({ data: NOTIFICATION_DATA, origin: ORIGIN, clients: [hidden, visible, focused] }),
    ).toMatchObject({
      focus: focused,
    });
    expect(resolveClickAction({ data: NOTIFICATION_DATA, origin: ORIGIN, clients: [hidden, visible] })).toMatchObject({
      focus: visible,
    });
    expect(
      resolveClickAction({ data: NOTIFICATION_DATA, origin: ORIGIN, clients: [hidden, visible] }),
    ).not.toMatchObject({
      focus: hidden,
    });
  });

  it('ignores cross-origin clients', () => {
    const foreign = makeClient({ url: 'https://evil.example.com/dashboard', focused: true });

    expect(resolveClickAction({ data: NOTIFICATION_DATA, origin: ORIGIN, clients: [foreign] })).toEqual({
      open: `${ORIGIN}${NOTIFICATION_DATA.path}`,
    });
  });

  it('opens a window when there are no clients', () => {
    expect(resolveClickAction({ data: NOTIFICATION_DATA, origin: ORIGIN, clients: [] })).toEqual({
      open: `${ORIGIN}${NOTIFICATION_DATA.path}`,
    });
  });

  it.each([
    ['an absolute URL', 'https://evil.example.com/x'],
    ['a protocol-relative URL', '//evil.example.com/x'],
    ['a backslash path', '/\\evil.example.com'],
    ['a path without a leading slash', 'notifications/1'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a non-string', 42],
    ['a missing path', undefined],
  ])('replaces %s with /dashboard', (_label, path) => {
    const action = resolveClickAction({ data: { ...NOTIFICATION_DATA, path }, origin: ORIGIN, clients: [] });

    expect(action).toEqual({ open: `${ORIGIN}/dashboard` });
  });

  it('uses /dashboard when data is not an object', () => {
    expect(resolveClickAction({ data: undefined, origin: ORIGIN, clients: [] })).toEqual({
      open: `${ORIGIN}/dashboard`,
    });
    expect(resolveClickAction({ data: 'x', origin: ORIGIN, clients: [] })).toEqual({ open: `${ORIGIN}/dashboard` });
  });

  it('sends a null notification id for a test push', () => {
    const client = makeClient();

    const action = resolveClickAction({
      data: { v: 1, kind: 'test', path: '/settings/notifications' },
      origin: ORIGIN,
      clients: [client],
    });

    expect(action).toMatchObject({
      message: { type: 'notification-click', notificationId: null, path: '/settings/notifications' },
    });
  });
});

describe('postClickWithAck', () => {
  const message = { type: 'notification-click', notificationId: 'n1', path: '/notifications/n1' } as const;

  it('resolves true when the app answers on the channel port', async () => {
    const client = makeClient({
      postMessage: vi.fn((_message: unknown, transfer?: MessagePort[]) => {
        transfer?.[0]?.postMessage('ack');
      }),
    });

    await expect(postClickWithAck({ client, message, timeoutMs: 1000 })).resolves.toBe(true);
    expect(client.postMessage).toHaveBeenCalledWith(message, [expect.anything()]);
  });

  it('resolves false after the timeout when nobody answers', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      const result = postClickWithAck({ client, message, timeoutMs: 1000 });

      await vi.advanceTimersByTimeAsync(1000);

      await expect(result).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves false when postMessage throws', async () => {
    const client = makeClient({
      postMessage: vi.fn(() => {
        throw new Error('detached');
      }),
    });

    await expect(postClickWithAck({ client, message, timeoutMs: 1000 })).resolves.toBe(false);
  });
});

describe('handleNotificationClick', () => {
  it('opens a window when no app window exists', async () => {
    const openWindow = vi.fn().mockResolvedValue(undefined);

    await handleNotificationClick({ data: NOTIFICATION_DATA, origin: ORIGIN, clients: [], openWindow, timeoutMs: 10 });

    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}${NOTIFICATION_DATA.path}`);
  });

  it('focuses the window and leaves routing to the app once it acknowledges', async () => {
    const client = makeClient({
      postMessage: vi.fn((_message: unknown, transfer?: MessagePort[]) => {
        transfer?.[0]?.postMessage('ack');
      }),
    });
    const openWindow = vi.fn();

    await handleNotificationClick({
      data: NOTIFICATION_DATA,
      origin: ORIGIN,
      clients: [client],
      openWindow,
      timeoutMs: 1000,
    });

    expect(client.focus).toHaveBeenCalledTimes(1);
    expect(client.navigate).not.toHaveBeenCalled();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('navigates the client to the fallback URL when the app never answers', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient();
      const openWindow = vi.fn();

      const done = handleNotificationClick({
        data: NOTIFICATION_DATA,
        origin: ORIGIN,
        clients: [client],
        openWindow,
        timeoutMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(1000);
      await done;

      expect(client.focus).toHaveBeenCalledTimes(1);
      expect(client.navigate).toHaveBeenCalledWith(`${ORIGIN}${NOTIFICATION_DATA.path}`);
      expect(openWindow).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('still routes when focus rejects', async () => {
    vi.useFakeTimers();
    try {
      const client = makeClient({ focus: vi.fn().mockRejectedValue(new Error('no activation')) });

      const done = handleNotificationClick({
        data: NOTIFICATION_DATA,
        origin: ORIGIN,
        clients: [client],
        openWindow: vi.fn(),
        timeoutMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(1000);
      await done;

      expect(client.navigate).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('announceEndpointChange', () => {
  it('posts the new endpoint to every window client', () => {
    const a = makeClient();
    const b = makeClient();

    announceEndpointChange({ clients: [a, b], endpoint: 'https://push.example/new' });

    for (const client of [a, b]) {
      expect(client.postMessage).toHaveBeenCalledWith({
        type: 'push-endpoint-changed',
        endpoint: 'https://push.example/new',
      });
    }
  });

  it('does nothing without window clients', () => {
    expect(() => announceEndpointChange({ clients: [], endpoint: 'https://push.example/new' })).not.toThrow();
  });
});

/** Mirrors a real PushSubscription: endpoint and expirationTime are prototype getters. */
class FakePushSubscription {
  get endpoint() {
    return 'https://push.example/new';
  }
  get expirationTime() {
    return null;
  }
  get options() {
    return { userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]).buffer };
  }
  toJSON() {
    return { endpoint: this.endpoint, expirationTime: this.expirationTime, keys: { p256dh: 'p', auth: 'a' } };
  }
}

describe('buildResubscribeRequest', () => {
  const apiBase = 'https://api.example.com/api/v1';

  it('builds the Rotate request from toJSON(), not from a spread of the object', () => {
    const request = buildResubscribeRequest({
      apiBase,
      oldEndpoint: 'https://push.example/old',
      subscription: new FakePushSubscription(),
    });

    expect(request).not.toBeNull();
    expect(request!.url).toBe(`${apiBase}/push/subscriptions`);
    expect(request!.init.method).toBe('POST');
    expect(request!.init.credentials).toBe('include');
    expect(request!.init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(request!.init.body)).toEqual({
      endpoint: 'https://push.example/new',
      expirationTime: null,
      keys: { p256dh: 'p', auth: 'a' },
      oldEndpoint: 'https://push.example/old',
    });
  });

  it('sends nothing without an old endpoint', () => {
    expect(
      buildResubscribeRequest({ apiBase, oldEndpoint: undefined, subscription: new FakePushSubscription() }),
    ).toBeNull();
  });

  it('sends nothing without an API base', () => {
    expect(
      buildResubscribeRequest({
        apiBase: null,
        oldEndpoint: 'https://push.example/old',
        subscription: new FakePushSubscription(),
      }),
    ).toBeNull();
  });
});

describe('handleSubscriptionChange', () => {
  const apiBase = 'https://api.example.com/api/v1';
  const oldSubscription = { endpoint: 'https://push.example/old', options: new FakePushSubscription().options };

  const run = ({
    old = oldSubscription as typeof oldSubscription | null,
    newSubscription = null as FakePushSubscription | null,
    status = 200,
    clients = [makeClient()],
  } = {}) => {
    const subscribe = vi.fn().mockResolvedValue(new FakePushSubscription());
    const fetchFn = vi.fn().mockResolvedValue({ status });
    const promise = handleSubscriptionChange({
      oldSubscription: old,
      newSubscription,
      subscribe,
      apiBase,
      fetchFn,
      listWindowClients: vi.fn().mockResolvedValue(clients),
    });
    return { promise, subscribe, fetchFn, clients };
  };

  it('does nothing without an old subscription', async () => {
    const { promise, subscribe, fetchFn } = run({ old: null });

    await promise;

    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('subscribes again with the old options, sends Rotate, and announces on a 200', async () => {
    const { promise, subscribe, fetchFn, clients } = run();

    await promise;

    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: oldSubscription.options.applicationServerKey,
    });
    expect(fetchFn).toHaveBeenCalledWith(`${apiBase}/push/subscriptions`, expect.objectContaining({ method: 'POST' }));
    expect(clients[0]!.postMessage).toHaveBeenCalledWith({
      type: 'push-endpoint-changed',
      endpoint: 'https://push.example/new',
    });
  });

  it('uses event.newSubscription when the browser provides one', async () => {
    const { promise, subscribe, fetchFn } = run({ newSubscription: new FakePushSubscription() });

    await promise;

    expect(subscribe).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it.each([401, 404, 409, 422, 500])('does not announce when Rotate answers %i', async (status) => {
    const { promise, clients } = run({ status });

    await promise;

    expect(clients[0]!.postMessage).not.toHaveBeenCalled();
  });

  it('swallows a network failure', async () => {
    const subscribe = vi.fn().mockResolvedValue(new FakePushSubscription());
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    const listWindowClients = vi.fn().mockResolvedValue([]);

    await expect(
      handleSubscriptionChange({
        oldSubscription,
        newSubscription: null,
        subscribe,
        apiBase,
        fetchFn,
        listWindowClients,
      }),
    ).resolves.toBeUndefined();
  });
});
