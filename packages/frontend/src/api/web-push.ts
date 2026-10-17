import { api } from '@/api/_api';
import { API_HTTP, API_VER } from '@/api/api-base-url';
import type {
  PushConfigResponse,
  PushDeviceDto,
  SendTestPushResponse,
  SubscribePushRequest,
  SyncPushSubscriptionResponse,
} from '@bt/shared/types';

interface QuietOptions {
  /** Suppresses the API client's error toast, for calls the user did not start. */
  silent?: boolean;
}

export const getPushConfig = async (): Promise<PushConfigResponse> => api.get('/push/config');

export const getPushDevices = async (): Promise<PushDeviceDto[]> => api.get('/push/subscriptions');

/** Enable, or Rotate when the payload carries `oldEndpoint`. */
export const subscribePush = async (
  payload: SubscribePushRequest,
  { silent = false }: QuietOptions = {},
): Promise<PushDeviceDto> => api.post('/push/subscriptions', payload, { silent });

export const syncPushSubscription = async ({ endpoint }: { endpoint: string }): Promise<SyncPushSubscriptionResponse> =>
  api.post('/push/subscriptions/sync', { endpoint }, { silent: true });

export const unsubscribePush = async (
  { endpoint }: { endpoint: string },
  { silent = false }: QuietOptions = {},
): Promise<void> => {
  await api.post('/push/subscriptions/unsubscribe', { endpoint }, { silent });
};

/**
 * A plain `fetch`, not the API client: the client answers an `unauthorized` response by calling
 * `logout()`, and this call runs inside an explicit logout, so a 401 would re-enter it.
 * Failures are ignored; the row is best-effort cleanup and a dead endpoint is pruned on the
 * next push anyway.
 */
export const unsubscribeEndpointRaw = async ({
  endpoint,
  signal,
}: {
  endpoint: string;
  signal?: AbortSignal;
}): Promise<boolean> => {
  try {
    const response = await fetch(`${API_HTTP}${API_VER}/push/subscriptions/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ endpoint }),
      signal,
    });
    return response.ok;
  } catch {
    return false;
  }
};

export const removePushDevice = async ({ id }: { id: string }): Promise<void> => {
  await api.delete(`/push/subscriptions/${id}`);
};

export const sendTestPush = async (): Promise<SendTestPushResponse> => api.post('/push/test');
