/// <reference lib="webworker" />
/**
 * Push service worker, served as /sw.js. It has no `fetch` handler, so it never sits on the
 * request path. The logic lives in `handlers.ts`.
 */
import {
  type OldPushSubscriptionLike,
  type PushNotificationLike,
  type PushSubscriptionLike,
  type ServiceWorkerClientLike,
  handleNotificationClick,
  handlePush,
  handleSubscriptionChange,
} from './handlers';

declare const self: ServiceWorkerGlobalScope;

interface PushEventLike extends ExtendableEvent {
  /** Set on a mutable declarative message (Safari 18.4+), whose `data` is then null. */
  readonly notification?: PushNotificationLike | null;
  readonly data: { text: () => string } | null;
}

interface PushSubscriptionChangeEventLike extends ExtendableEvent {
  readonly oldSubscription?: (OldPushSubscriptionLike & PushSubscriptionLike) | null;
  readonly newSubscription?: (PushSubscriptionLike & { endpoint: string }) | null;
}

interface BadgeNavigator {
  setAppBadge?: (count: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

const apiBase = new URL(self.location.href).searchParams.get('api');

const listWindowClients = async (): Promise<readonly ServiceWorkerClientLike[]> =>
  (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) as unknown as ServiceWorkerClientLike[];

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const pushEvent = event as PushEventLike;
  const badgeNavigator = self.navigator as unknown as BadgeNavigator;

  let dataText: string | null = null;
  try {
    dataText = pushEvent.data?.text() ?? null;
  } catch {
    dataText = null;
  }

  pushEvent.waitUntil(
    handlePush({
      notification: pushEvent.notification,
      dataText,
      show: ({ title, options }) => self.registration.showNotification(title, options),
      setBadge: badgeNavigator.setAppBadge
        ? async ({ count }) => {
            if (count > 0) await badgeNavigator.setAppBadge?.(count);
            else await badgeNavigator.clearAppBadge?.();
          }
        : undefined,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    (async () =>
      handleNotificationClick({
        data: event.notification.data,
        origin: self.location.origin,
        clients: await listWindowClients(),
        openWindow: (url) => self.clients.openWindow(url),
      }))(),
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  const changeEvent = event as PushSubscriptionChangeEventLike;

  changeEvent.waitUntil(
    handleSubscriptionChange({
      oldSubscription: changeEvent.oldSubscription,
      newSubscription: changeEvent.newSubscription,
      subscribe: (options) => self.registration.pushManager.subscribe(options),
      apiBase,
      fetchFn: (url, init) => fetch(url, init),
      listWindowClients,
    }),
  );
});
