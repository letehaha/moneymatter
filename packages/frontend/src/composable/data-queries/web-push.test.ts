import * as pushApi from '@/api/web-push';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import {
  usePushConfig,
  usePushDevices,
  useRemovePushDevice,
  useSendTestPush,
  useSubscribePush,
  useUnsubscribePush,
} from './web-push';

vi.mock('@/api/web-push', () => ({
  getPushConfig: vi.fn(),
  getPushDevices: vi.fn(),
  subscribePush: vi.fn(),
  unsubscribePush: vi.fn(),
  removePushDevice: vi.fn(),
  sendTestPush: vi.fn(),
}));

const mountComposable = <T>({ queryClient, setup }: { queryClient: QueryClient; setup: () => T }): T => {
  let result!: T;

  mount(
    defineComponent({
      setup() {
        result = setup();
        return () => null;
      },
    }),
    { global: { plugins: [[VueQueryPlugin, { queryClient }]] } },
  );

  return result;
};

describe('web-push data queries', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('reads the config under the pushConfig cache key', async () => {
    vi.mocked(pushApi.getPushConfig).mockResolvedValue({ enabled: true, vapidPublicKey: 'key' });
    const { config } = mountComposable({ queryClient, setup: () => usePushConfig() });

    await vi.waitFor(() => expect(config.value).toEqual({ enabled: true, vapidPublicKey: 'key' }));

    expect(queryClient.getQueryData(VUE_QUERY_CACHE_KEYS.pushConfig)).toEqual({ enabled: true, vapidPublicKey: 'key' });
  });

  it('reads the devices under the pushDevices cache key', async () => {
    vi.mocked(pushApi.getPushDevices).mockResolvedValue([]);
    const { devices } = mountComposable({ queryClient, setup: () => usePushDevices() });

    await vi.waitFor(() => expect(devices.value).toEqual([]));

    expect(queryClient.getQueryData(VUE_QUERY_CACHE_KEYS.pushDevices)).toEqual([]);
  });

  it.each([
    [
      'useSubscribePush',
      useSubscribePush,
      pushApi.subscribePush,
      { payload: { endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } } },
    ],
    ['useUnsubscribePush', useUnsubscribePush, pushApi.unsubscribePush, { endpoint: 'e' }],
    ['useRemovePushDevice', useRemovePushDevice, pushApi.removePushDevice, { id: 'device-1' }],
    ['useSendTestPush', useSendTestPush, pushApi.sendTestPush, undefined],
  ] as const)('%s invalidates the device list on success', async (_name, useMutationHook, apiFn, variables) => {
    vi.mocked(apiFn as (...args: unknown[]) => Promise<unknown>).mockResolvedValue(undefined);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const mutation = mountComposable({ queryClient, setup: () => useMutationHook() });

    await (mutation.mutateAsync as (variables?: unknown) => Promise<unknown>)(variables);

    expect(invalidate).toHaveBeenCalledWith({ queryKey: VUE_QUERY_CACHE_KEYS.pushDevices });
  });

  it('does not invalidate the device list when a mutation fails', async () => {
    vi.mocked(pushApi.removePushDevice).mockRejectedValue(new Error('boom'));
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const mutation = mountComposable({ queryClient, setup: () => useRemovePushDevice() });

    await expect(mutation.mutateAsync({ id: 'device-1' })).rejects.toThrow('boom');

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('passes silent through to the subscribe call', async () => {
    vi.mocked(pushApi.subscribePush).mockResolvedValue({} as never);
    const mutation = mountComposable({ queryClient, setup: () => useSubscribePush() });
    const payload = { endpoint: 'e', keys: { p256dh: 'p', auth: 'a' } };

    await mutation.mutateAsync({ payload, silent: true });

    expect(pushApi.subscribePush).toHaveBeenCalledWith({ payload, silent: true });
  });
});
