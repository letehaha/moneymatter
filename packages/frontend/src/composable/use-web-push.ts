import * as pushApi from '@/api/web-push';
import { urlBase64ToUint8Array } from '@/common/utils/base64url';
import { getDeviceName } from '@/common/utils/device-name';
import { registerServiceWorker } from '@/common/utils/register-service-worker';
import {
  clearStoredEndpoint,
  getEndpointHash,
  getStoredEndpoint,
  setStoredEndpoint,
} from '@/common/utils/web-push-device';
import { type PushSupport, getPushSupport } from '@/common/utils/web-push-support';
import {
  pushConfigQueryOptions,
  usePushConfig,
  useSubscribePush,
  useUnsubscribePush,
} from '@/composable/data-queries/web-push';
import { useSafariDetection } from '@/composable/detect-safari';
import { isNotFoundError } from '@/js/errors';
import { useUserStore } from '@/stores';
import type { PushConfigResponse, SubscribePushRequest } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';
import { computed, ref, shallowRef } from 'vue';

/**
 * - `checking`: the config or the worker registration is still loading.
 * - `server-disabled`: the instance has no VAPID keys.
 * - `unsupported` / `needs-home-screen` / `denied`: see `PushSupport`.
 * - `off` / `on`: this device is not / is subscribed.
 */
type WebPushState = 'checking' | 'server-disabled' | 'unsupported' | 'needs-home-screen' | 'denied' | 'off' | 'on';

type EnableResult = 'enabled' | 'denied' | 'dismissed' | 'tap-again' | 'failed';

const HOME_SCREEN_LABEL_SUFFIX = ' (Home Screen)';
const DEVICE_LABEL_FALLBACK = 'Browser';

// Module state: the dashboard layout reconciles on app load and the settings page reads the
// result, so both must see one subscription state.
const registration = shallowRef<ServiceWorkerRegistration | null>(null);
const support = ref<PushSupport>('unsupported');
const isSubscribed = ref(false);
const thisEndpointHash = ref<string | null>(null);
const needsTapAgain = ref(false);
const isPending = ref(false);
let syncOnLoadPromise: Promise<void> | null = null;

/** Clears the module state. The app never calls it; specs do, to start each case from a fresh page load. */
export const resetWebPushState = () => {
  registration.value = null;
  support.value = 'unsupported';
  isSubscribed.value = false;
  thisEndpointHash.value = null;
  needsTapAgain.value = false;
  isPending.value = false;
  syncOnLoadPromise = null;
};

const refreshSupport = () => {
  support.value = getPushSupport();
};

const isPushUsable = () => support.value === 'default' || support.value === 'granted';

const hasSameKey = ({ subscription, key }: { subscription: PushSubscription; key: Uint8Array }): boolean => {
  const current = subscription.options?.applicationServerKey;
  if (!current || current.byteLength !== key.byteLength) return false;

  const currentBytes = new Uint8Array(current);
  return currentBytes.every((byte, index) => byte === key[index]);
};

const buildDeviceLabel = (): string => {
  const { isIOS, isPWA } = useSafariDetection();
  const name = getDeviceName({ fallback: DEVICE_LABEL_FALLBACK });

  return isIOS && isPWA ? `${name}${HOME_SCREEN_LABEL_SUFFIX}` : name;
};

/** `null` when the browser handed back a subscription without its keys. */
const toSubscribeRequest = ({
  subscription,
  oldEndpoint,
}: {
  subscription: PushSubscription;
  oldEndpoint?: string;
}): SubscribePushRequest | null => {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) return null;

  return {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
    expirationTime: json.expirationTime ?? null,
    deviceLabel: buildDeviceLabel(),
    ...(oldEndpoint ? { oldEndpoint } : {}),
  };
};

export const useWebPush = () => {
  const queryClient = useQueryClient();
  const userStore = useUserStore();
  const { config, isError: isConfigError } = usePushConfig();
  const subscribeMutation = useSubscribePush();
  const unsubscribeMutation = useUnsubscribePush();

  refreshSupport();

  const state = computed<WebPushState>(() => {
    if (isConfigError.value) return 'server-disabled';
    if (!config.value) return 'checking';
    if (!config.value.enabled) return 'server-disabled';
    if (!isPushUsable()) return support.value as WebPushState;
    if (!registration.value) return 'checking';

    return isSubscribed.value ? 'on' : 'off';
  });

  const ensureConfig = (): Promise<PushConfigResponse> => queryClient.ensureQueryData(pushConfigQueryOptions);

  const currentUserId = () => userStore.user?.id;

  const markSubscribed = async ({ subscription }: { subscription: PushSubscription }) => {
    isSubscribed.value = true;
    thisEndpointHash.value = await getEndpointHash({ endpoint: subscription.endpoint });
  };

  const markUnsubscribed = () => {
    isSubscribed.value = false;
    thisEndpointHash.value = null;
    const userId = currentUserId();
    if (userId !== undefined) clearStoredEndpoint({ userId });
  };

  /** Drops the browser subscription of a device the server does not know, without a server call. */
  const dropBrowserSubscription = async ({ subscription }: { subscription: PushSubscription }) => {
    await subscription.unsubscribe().catch(() => false);
    markUnsubscribed();
  };

  /**
   * Returns the browser subscription when it uses the current VAPID key. A subscription made with
   * another key can never receive a push from this instance, and `subscribe()` would throw on it,
   * so it is removed here, outside the enable click, and the toggle stays off.
   */
  const inspectSubscription = async ({
    activeRegistration,
    vapidPublicKey,
  }: {
    activeRegistration: ServiceWorkerRegistration;
    vapidPublicKey: string;
  }): Promise<PushSubscription | null> => {
    const subscription = await activeRegistration.pushManager.getSubscription();
    if (!subscription) return null;

    if (hasSameKey({ subscription, key: urlBase64ToUint8Array({ value: vapidPublicKey }) })) return subscription;

    await subscription.unsubscribe().catch(() => false);
    await unsubscribeMutation.mutateAsync({ endpoint: subscription.endpoint, silent: true }).catch(() => undefined);
    markUnsubscribed();

    return null;
  };

  /** Tells the server about the browser's subscription: a rotation when the endpoint moved, else a sync. */
  const reconcileWithServer = async ({
    subscription,
    userId,
  }: {
    subscription: PushSubscription;
    userId: string | number;
  }) => {
    const storedEndpoint = getStoredEndpoint({ userId });

    try {
      if (storedEndpoint && storedEndpoint !== subscription.endpoint) {
        const payload = toSubscribeRequest({ subscription, oldEndpoint: storedEndpoint });
        if (!payload) return;

        await subscribeMutation.mutateAsync({ payload, silent: true });
        setStoredEndpoint({ userId, endpoint: subscription.endpoint });
        await markSubscribed({ subscription });
        return;
      }

      const { known } = await pushApi.syncPushSubscription({ endpoint: subscription.endpoint });

      if (known) {
        setStoredEndpoint({ userId, endpoint: subscription.endpoint });
        await markSubscribed({ subscription });
      } else {
        await dropBrowserSubscription({ subscription });
      }
    } catch (error) {
      // The row is gone under both endpoints: the device was removed elsewhere and stays removed.
      if (isNotFoundError(error)) await dropBrowserSubscription({ subscription });
    }
  };

  const runSyncOnLoad = async () => {
    refreshSupport();
    if (!isPushUsable()) return;

    const { enabled, vapidPublicKey } = await ensureConfig();
    const userId = currentUserId();
    if (!enabled || !vapidPublicKey || userId === undefined) return;

    // A registration exists only after the user enabled push here once; the app load never creates one.
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (!existing) return;

    const activeRegistration = await navigator.serviceWorker.ready;
    registration.value = activeRegistration;

    const subscription = await inspectSubscription({ activeRegistration, vapidPublicKey });
    if (subscription) await reconcileWithServer({ subscription, userId });
  };

  /** App-load reconcile, once per page load. Never prompts, registers a worker or enrols a device. */
  const syncOnLoad = (): Promise<void> => {
    syncOnLoadPromise ??= runSyncOnLoad().catch(() => undefined);

    return syncOnLoadPromise;
  };

  /**
   * Settings page mount: registers the worker and waits until it is active, so the enable click can
   * call `pushManager.subscribe()` as its first await (Safari drops the user gesture otherwise).
   */
  const prepare = async (): Promise<void> => {
    await syncOnLoad();
    if (!isPushUsable()) return;

    const { enabled, vapidPublicKey } = await ensureConfig();
    if (!enabled || !vapidPublicKey) return;

    if (!registration.value) {
      const registered = await registerServiceWorker();
      if (!registered) return;

      registration.value = await navigator.serviceWorker.ready;
    }

    await inspectSubscription({ activeRegistration: registration.value, vapidPublicKey });
  };

  const enable = async (): Promise<EnableResult> => {
    const activeRegistration = registration.value;
    const vapidPublicKey = config.value?.vapidPublicKey;
    if (!activeRegistration || !vapidPublicKey) return 'failed';

    isPending.value = true;
    needsTapAgain.value = false;

    try {
      let subscription: PushSubscription;

      try {
        // The first await of the click: it raises the permission prompt inside the user gesture.
        subscription = await activeRegistration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array({ value: vapidPublicKey }),
        });
      } catch (error) {
        refreshSupport();

        if (error instanceof DOMException && error.name === 'InvalidStateError') {
          // A subscription under another key is still there: remove it now, the next tap has its own gesture.
          const stale = await activeRegistration.pushManager.getSubscription().catch(() => null);
          await stale?.unsubscribe().catch(() => false);
          needsTapAgain.value = true;
          return 'tap-again';
        }

        return support.value === 'denied' ? 'denied' : 'dismissed';
      }

      refreshSupport();

      const payload = toSubscribeRequest({ subscription });
      if (!payload) {
        await subscription.unsubscribe().catch(() => false);
        return 'failed';
      }

      try {
        await subscribeMutation.mutateAsync({ payload });
      } catch {
        await subscription.unsubscribe().catch(() => false);
        return 'failed';
      }

      const userId = currentUserId();
      if (userId !== undefined) setStoredEndpoint({ userId, endpoint: subscription.endpoint });
      await markSubscribed({ subscription });

      return 'enabled';
    } finally {
      isPending.value = false;
    }
  };

  const disable = async (): Promise<void> => {
    const activeRegistration = registration.value;
    if (!activeRegistration) return;

    isPending.value = true;

    try {
      const subscription = await activeRegistration.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;

      await subscription?.unsubscribe();
      markUnsubscribed();

      if (endpoint) await unsubscribeMutation.mutateAsync({ endpoint });
    } finally {
      isPending.value = false;
    }
  };

  /**
   * The worker rotated the subscription itself and told the page; there is no request to make.
   * Only a user who registered this browser (has a stored endpoint) takes the new one, so a
   * rotation never attaches the subscription to an account that did not opt in.
   */
  const handleEndpointChanged = async ({ endpoint }: { endpoint: string }): Promise<void> => {
    const userId = currentUserId();
    if (userId === undefined || getStoredEndpoint({ userId }) === null) return;

    setStoredEndpoint({ userId, endpoint });
    thisEndpointHash.value = await getEndpointHash({ endpoint });
  };

  const isThisDevice = ({ endpointHash }: { endpointHash: string }): boolean =>
    thisEndpointHash.value !== null && endpointHash === thisEndpointHash.value;

  return {
    state,
    isPending,
    needsTapAgain,
    config,
    prepare,
    syncOnLoad,
    enable,
    disable,
    handleEndpointChanged,
    isThisDevice,
  };
};
