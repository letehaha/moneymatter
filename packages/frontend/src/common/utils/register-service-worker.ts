import { API_HTTP, API_VER } from '@/api/api-base-url';

const SERVICE_WORKER_PATH = '/sw.js';
const SERVICE_WORKER_SCOPE = '/';

/**
 * Registers the push worker, or returns the registration that already exists. The worker's
 * Rotate request needs the full API base, which travels as the `api` query of the script URL.
 * `updateViaCache: 'none'` makes every update check bypass the HTTP cache.
 */
export const registerServiceWorker = async (): Promise<ServiceWorkerRegistration | null> => {
  if (!('serviceWorker' in navigator)) return null;

  const existing = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_SCOPE);
  if (existing) return existing;

  const apiBase = encodeURIComponent(`${API_HTTP}${API_VER}`);

  return navigator.serviceWorker.register(`${SERVICE_WORKER_PATH}?api=${apiBase}`, {
    scope: SERVICE_WORKER_SCOPE,
    updateViaCache: 'none',
  });
};
