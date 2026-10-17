/**
 * Pure logic of the push service worker. `sw.ts` wires these to the worker's events; keeping
 * them free of worker globals lets vitest cover them. Types are structural so the file
 * compiles under both the DOM lib (the app and its tests) and the WebWorker lib (the worker).
 */

export const NOTIFICATION_ICON = '/web-app-manifest-192x192.png';
export const NOTIFICATION_BADGE = '/favicon-96x96.png';

/** Shown when a push carries nothing usable: every push must show a notification. */
export const FALLBACK_TITLE = 'MoneyMatter';
export const FALLBACK_BODY = 'You have a new notification';

const DASHBOARD_PATH = '/dashboard';
const CLICK_ACK_TIMEOUT_MS = 1000;

/** `event.notification` of a mutable declarative push: a `Notification` read through prototype getters. */
export interface PushNotificationLike {
  title?: string | null;
  body?: string | null;
  tag?: string | null;
  lang?: string | null;
  data?: unknown;
}

interface ShownNotificationOptions {
  body?: string;
  tag?: string;
  lang?: string;
  data?: unknown;
  icon: string;
  badge: string;
}

interface ShownNotification {
  title: string;
  options: ShownNotificationOptions;
}

interface ClickMessage {
  type: 'notification-click';
  notificationId: string | null;
  path: string;
}

export interface ServiceWorkerClientLike {
  url: string;
  focused?: boolean;
  visibilityState?: string;
  focus: () => Promise<unknown>;
  navigate: (url: string) => Promise<unknown>;
  postMessage: (message: unknown, transfer?: MessagePort[]) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined;

const buildShown = ({
  source,
}: {
  source: PushNotificationLike | Record<string, unknown>;
}): ShownNotification | null => {
  const title = nonEmptyString(source.title);
  if (!title) return null;

  const body = nonEmptyString(source.body);
  const tag = nonEmptyString(source.tag);
  const lang = nonEmptyString(source.lang);

  return {
    title,
    options: {
      ...(body !== undefined && { body }),
      ...(tag !== undefined && { tag }),
      ...(lang !== undefined && { lang }),
      ...(source.data !== undefined && { data: source.data }),
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
    },
  };
};

const parseDataText = ({ dataText }: { dataText: string | null | undefined }): ShownNotification | null => {
  if (!dataText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(dataText);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  // A declarative message nests the notification under `notification`; a bare payload has it
  // at the top level. `web_push` and `mutable` are read by the browser, not shown.
  const source = isRecord(parsed.notification) ? parsed.notification : parsed;
  return buildShown({ source });
};

/**
 * A mutable declarative message reaches the worker as `event.notification` with a null
 * `event.data`; every other browser delivers JSON in `event.data`. Never throws, and always
 * yields something to show.
 */
export const parsePushEvent = ({
  notification,
  dataText,
}: {
  notification: PushNotificationLike | null | undefined;
  dataText: string | null | undefined;
}): ShownNotification => {
  const fromNotification = notification ? buildShown({ source: notification }) : null;
  if (fromNotification) return fromNotification;

  const fromData = parseDataText({ dataText });
  if (fromData) return fromData;

  return {
    title: FALLBACK_TITLE,
    options: { body: FALLBACK_BODY, icon: NOTIFICATION_ICON, badge: NOTIFICATION_BADGE },
  };
};

const readUnreadCount = ({ data }: { data: unknown }): number | null => {
  if (!isRecord(data)) return null;
  const { unreadCount } = data;
  return typeof unreadCount === 'number' && Number.isFinite(unreadCount) && unreadCount >= 0
    ? Math.floor(unreadCount)
    : null;
};

/**
 * Shows the notification, then updates the app badge. The notification comes first and a badge
 * failure never rejects: Safari revokes a subscription whose push shows nothing.
 */
export const handlePush = async ({
  notification,
  dataText,
  show,
  setBadge,
}: {
  notification: PushNotificationLike | null | undefined;
  dataText: string | null | undefined;
  show: (shown: ShownNotification) => Promise<unknown>;
  setBadge?: (params: { count: number }) => Promise<unknown>;
}): Promise<void> => {
  const shown = parsePushEvent({ notification, dataText });
  await show(shown);

  const count = readUnreadCount({ data: shown.options.data });
  if (count === null || !setBadge) return;
  try {
    await setBadge({ count });
  } catch {
    // The Badging API is optional and the notification is already shown.
  }
};

/** Only a same-origin path that starts with a single `/` is trusted; anything else opens the dashboard. */
const safePath = ({ path, origin }: { path: unknown; origin: string }): string => {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) {
    return DASHBOARD_PATH;
  }
  try {
    return new URL(path, origin).origin === origin ? path : DASHBOARD_PATH;
  } catch {
    return DASHBOARD_PATH;
  }
};

const isSameOrigin = ({ url, origin }: { url: string; origin: string }): boolean => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

type ClickAction = { focus: ServiceWorkerClientLike; message: ClickMessage; fallbackUrl: string } | { open: string };

export const resolveClickAction = ({
  data,
  origin,
  clients,
}: {
  data: unknown;
  origin: string;
  clients: readonly ServiceWorkerClientLike[];
}): ClickAction => {
  const record = isRecord(data) ? data : {};
  const path = safePath({ path: record.path, origin });
  const url = `${origin}${path}`;

  const windows = clients.filter((client) => isSameOrigin({ url: client.url, origin }));
  const client =
    windows.find((candidate) => candidate.focused) ??
    windows.find((candidate) => candidate.visibilityState === 'visible') ??
    windows[0];
  if (!client) return { open: url };

  return {
    focus: client,
    message: {
      type: 'notification-click',
      notificationId: nonEmptyString(record.notificationId) ?? null,
      path,
    },
    fallbackUrl: url,
  };
};

/**
 * Sends the click to the app on a `MessageChannel` and waits for it to answer on the port.
 * `false` means no acknowledgement within `timeoutMs`: the window may show the sign-in page
 * (its layout has no receiver) or still be loading.
 */
export const postClickWithAck = ({
  client,
  message,
  timeoutMs,
}: {
  client: Pick<ServiceWorkerClientLike, 'postMessage'>;
  message: ClickMessage;
  timeoutMs: number;
}): Promise<boolean> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = ({ acknowledged }: { acknowledged: boolean }) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(acknowledged);
    };

    channel.port1.onmessage = () => finish({ acknowledged: true });
    timer = setTimeout(() => finish({ acknowledged: false }), timeoutMs);

    try {
      client.postMessage(message, [channel.port2]);
    } catch {
      finish({ acknowledged: false });
    }
  });

export const handleNotificationClick = async ({
  data,
  origin,
  clients,
  openWindow,
  timeoutMs = CLICK_ACK_TIMEOUT_MS,
}: {
  data: unknown;
  origin: string;
  clients: readonly ServiceWorkerClientLike[];
  openWindow: (url: string) => Promise<unknown>;
  timeoutMs?: number;
}): Promise<void> => {
  const action = resolveClickAction({ data, origin, clients });
  if ('open' in action) {
    await openWindow(action.open);
    return;
  }

  const { focus: client, message, fallbackUrl } = action;
  try {
    await client.focus();
  } catch {
    // Routing below does not depend on the window gaining focus.
  }

  const acknowledged = await postClickWithAck({ client, message, timeoutMs });
  if (!acknowledged) await client.navigate(fallbackUrl);
};

/** Tells open windows which endpoint the browser rotated to; the worker cannot write `localStorage`. */
export const announceEndpointChange = ({
  clients,
  endpoint,
}: {
  clients: readonly Pick<ServiceWorkerClientLike, 'postMessage'>[];
  endpoint: string;
}): void => {
  for (const client of clients) {
    client.postMessage({ type: 'push-endpoint-changed', endpoint });
  }
};

/** What `toJSON()` of a `PushSubscription` returns. */
interface PushSubscriptionJsonLike {
  endpoint?: string;
  expirationTime?: number | null;
  keys?: Record<string, string>;
}

/** `endpoint`, `expirationTime` and `options` are prototype getters on a real `PushSubscription`. */
export interface PushSubscriptionLike {
  toJSON: () => PushSubscriptionJsonLike;
}

export interface OldPushSubscriptionLike {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
}

interface ResubscribeRequest {
  url: string;
  init: { method: 'POST'; credentials: 'include'; headers: Record<string, string>; body: string };
}

/**
 * The Rotate request. `toJSON()` is required: a spread of the subscription object copies
 * nothing, as its fields live on the prototype. `apiBase` is the full API base (host and
 * version prefix) the app passes as `?api=` on the worker's script URL.
 */
export const buildResubscribeRequest = ({
  apiBase,
  oldEndpoint,
  subscription,
}: {
  apiBase: string | null | undefined;
  oldEndpoint: string | null | undefined;
  subscription: PushSubscriptionLike;
}): ResubscribeRequest | null => {
  if (!apiBase || !oldEndpoint) return null;

  return {
    url: `${apiBase}/push/subscriptions`,
    init: {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(), oldEndpoint }),
    },
  };
};

/**
 * `pushsubscriptionchange`: re-subscribes with the old options and sends Rotate. Without
 * `oldSubscription` there is nothing to rotate. The app-load reconcile is the fallback for a
 * failed request (an expired session, no network), so errors end here.
 */
export const handleSubscriptionChange = async ({
  oldSubscription,
  newSubscription,
  subscribe,
  apiBase,
  fetchFn,
  listWindowClients,
}: {
  oldSubscription: OldPushSubscriptionLike | null | undefined;
  newSubscription: (PushSubscriptionLike & { endpoint: string }) | null | undefined;
  subscribe: (options: {
    userVisibleOnly: true;
    applicationServerKey: ArrayBuffer | null;
  }) => Promise<PushSubscriptionLike & { endpoint: string }>;
  apiBase: string | null | undefined;
  fetchFn: (url: string, init: ResubscribeRequest['init']) => Promise<{ status: number }>;
  listWindowClients: () => Promise<readonly Pick<ServiceWorkerClientLike, 'postMessage'>[]>;
}): Promise<void> => {
  if (!oldSubscription) return;

  try {
    const subscription =
      newSubscription ??
      (await subscribe({
        userVisibleOnly: true,
        applicationServerKey: oldSubscription.options.applicationServerKey,
      }));

    const request = buildResubscribeRequest({ apiBase, oldEndpoint: oldSubscription.endpoint, subscription });
    if (!request) return;

    const response = await fetchFn(request.url, request.init);
    if (response.status !== 200) return;

    announceEndpointChange({ clients: await listWindowClients(), endpoint: subscription.endpoint });
  } catch {
    // Handled by the app-load reconcile.
  }
};
