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
export type WebPushState =
  | 'checking'
  | 'server-disabled'
  | 'unsupported'
  | 'needs-home-screen'
  | 'denied'
  | 'off'
  | 'on';

export type EnableResult = 'enabled' | 'denied' | 'dismissed' | 'tap-again' | 'failed';

const HOME_SCREEN_LABEL_SUFFIX = ' (Home Screen)';
const DEVICE_LABEL_FALLBACK = 'Browser';

// Module state: the dashboard layout reconciles on app load and the settings page reads the
// result, so both must see one subscription state. It belongs to one account (`stateOwnerId`): the
// SPA signs out and in without a page reload, so the next account must not inherit it.
const registration = shallowRef<ServiceWorkerRegistration | null>(null);
const support = ref<PushSupport>('unsupported');
const isSubscribed = ref(false);
const thisEndpointHash = ref<string | null>(null);
const needsTapAgain = ref(false);
const isPending = ref(false);
const stateOwnerId = ref<string | number | undefined>(undefined);
let syncOnLoadPromise: Promise<void> | null = null;
// Bumped by every reset, so a reconciliation that started under an earlier account can tell it is stale.
let stateEpoch = 0;

/** Clears the module state, for a new account and for specs that start each case from a fresh page load. */
export const resetWebPushState = () => {
  stateEpoch += 1;
  stateOwnerId.value = undefined;
  registration.value = null;
  support.value = 'unsupported';
  isSubscribed.value = false;
  thisEndpointHash.value = null;
  needsTapAgain.value = false;
  isPending.value = false;
  syncOnLoadPromise = null;
};

/** Hands the module state to `userId`, dropping what the previous account left behind. */
const claimState = ({ userId }: { userId: string | number }) => {
  if (stateOwnerId.value !== undefined && stateOwnerId.value !== userId) resetWebPushState();
  stateOwnerId.value = userId;
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

  const currentUserId = () => userStore.user?.id;

  // False between an account change and the new account's first reconcile.
  const ownsState = () => stateOwnerId.value !== undefined && stateOwnerId.value === currentUserId();

  const state = computed<WebPushState>(() => {
    if (isConfigError.value) return 'server-disabled';
    if (!config.value) return 'checking';
    if (!config.value.enabled) return 'server-disabled';
    if (!isPushUsable()) return support.value as WebPushState;
    if (!registration.value || !ownsState()) return 'checking';

    return isSubscribed.value ? 'on' : 'off';
  });

  const ensureConfig = (): Promise<PushConfigResponse> => queryClient.ensureQueryData(pushConfigQueryOptions);

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

  /** The browser holds no subscription: forget this device's state. The stored endpoint stays, since a rotation may be mid-flight. */
  const markNoBrowserSubscription = () => {
    isSubscribed.value = false;
    thisEndpointHash.value = null;
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
    if (!subscription) {
      markNoBrowserSubscription();
      return null;
    }

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
    const startEpoch = stateEpoch;

    try {
      if (storedEndpoint && storedEndpoint !== subscription.endpoint) {
        const payload = toSubscribeRequest({ subscription, oldEndpoint: storedEndpoint });
        if (!payload) return;

        await subscribeMutation.mutateAsync({ payload, silent: true });
        if (stateEpoch !== startEpoch) return;

        setStoredEndpoint({ userId, endpoint: subscription.endpoint });
        await markSubscribed({ subscription });
        return;
      }

      const { known } = await pushApi.syncPushSubscription({ endpoint: subscription.endpoint });
      // The account changed while the request was in flight: its answer is not for the next account.
      if (stateEpoch !== startEpoch) return;

      if (known) {
        setStoredEndpoint({ userId, endpoint: subscription.endpoint });
        await markSubscribed({ subscription });
      } else {
        await dropBrowserSubscription({ subscription });
      }
    } catch (error) {
      // The row is gone under both endpoints: the device was removed elsewhere and stays removed.
      if (stateEpoch === startEpoch && isNotFoundError(error)) await dropBrowserSubscription({ subscription });
    }
  };

  const runSyncOnLoad = async ({ userId }: { userId: string | number }) => {
    const startEpoch = stateEpoch;

    refreshSupport();
    if (!isPushUsable()) return;

    const { enabled, vapidPublicKey } = await ensureConfig();
    if (!enabled || !vapidPublicKey) return;

    // A registration exists only once the Notifications settings page has been opened here; the app load never creates one.
    const existing = await navigator.serviceWorker.getRegistration('/');
    if (!existing) return;

    const activeRegistration = await navigator.serviceWorker.ready;
    if (stateEpoch !== startEpoch) return;
    registration.value = activeRegistration;

    const subscription = await inspectSubscription({ activeRegistration, vapidPublicKey });
    if (subscription && stateEpoch === startEpoch) await reconcileWithServer({ subscription, userId });
  };

  /**
   * App-load reconcile, once per page load and account: signing out and in as someone else in the
   * same tab starts it over. Never prompts, registers a worker or enrols a device.
   */
  const syncOnLoad = (): Promise<void> => {
    const userId = currentUserId();
    if (userId === undefined) return Promise.resolve();

    claimState({ userId });
    syncOnLoadPromise ??= runSyncOnLoad({ userId }).catch(() => undefined);

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
    ownsState() && thisEndpointHash.value !== null && endpointHash === thisEndpointHash.value;

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
