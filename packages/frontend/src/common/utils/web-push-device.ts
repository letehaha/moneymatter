import { unsubscribeEndpointRaw } from '@/api/web-push';
import { layoutFingerprint } from '@/common/utils/layout-fingerprint';

const STORED_ENDPOINT_KEY_PREFIX = 'web-push-endpoint:';
const ENDPOINT_HASH_LENGTH = 16;
const LOGOUT_CLEANUP_TIMEOUT_MS = 5000;

const storedEndpointKey = ({ userId }: { userId: string | number }) => `${STORED_ENDPOINT_KEY_PREFIX}${userId}`;

/**
 * The endpoint this browser last registered for the user. A service worker cannot write
 * `localStorage`, so after a rotation the page learns the new endpoint from the worker's message.
 * Storage can be blocked or throw, so every access is guarded and falls back to "nothing stored".
 */
export const getStoredEndpoint = ({ userId }: { userId: string | number }): string | null => {
  try {
    return localStorage.getItem(storedEndpointKey({ userId }));
  } catch {
    return null;
  }
};

export const setStoredEndpoint = ({ userId, endpoint }: { userId: string | number; endpoint: string }): void => {
  try {
    localStorage.setItem(storedEndpointKey({ userId }), endpoint);
  } catch {
    // Without storage the next load falls back to `/sync`, which never re-enrols a device.
  }
};

export const clearStoredEndpoint = ({ userId }: { userId: string | number }): void => {
  try {
    localStorage.removeItem(storedEndpointKey({ userId }));
  } catch {
    // Nothing stored that could be stale.
  }
};

/** Matches the backend's `endpointHash`: the first 16 hex characters of SHA-256 over the endpoint. */
export const getEndpointHash = async ({ endpoint }: { endpoint: string }): Promise<string> =>
  (await layoutFingerprint({ value: endpoint })).slice(0, ENDPOINT_HASH_LENGTH);

const getExistingSubscription = async (): Promise<PushSubscription | null> => {
  if (!('serviceWorker' in navigator)) return null;

  const registration = await navigator.serviceWorker.getRegistration('/');

  return (await registration?.pushManager?.getSubscription()) ?? null;
};

/**
 * Removes this device on an explicit sign-out: the server row first (a plain `fetch`, so a 401
 * cannot re-enter `logout()`), then the browser subscription, then the stored endpoint. Each step
 * is best-effort and bounded, because sign-out must not wait on a push service or a dead network.
 */
export const removeThisDevice = async ({ userId }: { userId: string | number | undefined }): Promise<void> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGOUT_CLEANUP_TIMEOUT_MS);

  try {
    const subscription = await Promise.race([
      getExistingSubscription().catch(() => null),
      new Promise<null>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(null));
      }),
    ]);

    if (subscription) {
      await unsubscribeEndpointRaw({ endpoint: subscription.endpoint, signal: controller.signal }).catch(() => false);
      await subscription.unsubscribe().catch(() => false);
    }
  } finally {
    clearTimeout(timer);
    if (userId !== undefined) clearStoredEndpoint({ userId });
  }
};
