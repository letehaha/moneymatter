import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { type VueWrapper, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, ref } from 'vue';

import { syncAppBadge, useAppBadge } from './use-app-badge';

const unreadCount = ref<number | undefined>(undefined);

vi.mock('@/composable/data-queries/notifications', () => ({
  useUnreadNotificationsCount: () => ({ data: unreadCount }),
}));

describe('syncAppBadge', () => {
  it('sets the badge to the count', async () => {
    const nav = { setAppBadge: vi.fn().mockResolvedValue(undefined), clearAppBadge: vi.fn() };

    await syncAppBadge({ count: 3, nav });

    expect(nav.setAppBadge).toHaveBeenCalledWith(3);
    expect(nav.clearAppBadge).not.toHaveBeenCalled();
  });

  it('clears the badge at zero', async () => {
    const nav = { setAppBadge: vi.fn(), clearAppBadge: vi.fn().mockResolvedValue(undefined) };

    await syncAppBadge({ count: 0, nav });

    expect(nav.clearAppBadge).toHaveBeenCalledOnce();
    expect(nav.setAppBadge).not.toHaveBeenCalled();
  });

  it('sets the badge to 0 when there is no clearAppBadge', async () => {
    const nav = { setAppBadge: vi.fn().mockResolvedValue(undefined) };

    await syncAppBadge({ count: 0, nav });

    expect(nav.setAppBadge).toHaveBeenCalledWith(0);
  });

  it('does nothing without setAppBadge', async () => {
    await expect(syncAppBadge({ count: 2, nav: {} })).resolves.toBeUndefined();
  });

  it('swallows a rejected badge call', async () => {
    const nav = { setAppBadge: vi.fn().mockRejectedValue(new Error('not allowed')) };

    await expect(syncAppBadge({ count: 2, nav })).resolves.toBeUndefined();
  });
});

describe('useAppBadge', () => {
  const setAppBadge = vi.fn().mockResolvedValue(undefined);
  const clearAppBadge = vi.fn().mockResolvedValue(undefined);

  const mounted: VueWrapper[] = [];

  const mountBadge = () => {
    const wrapper = mount(
      defineComponent({
        setup() {
          useAppBadge();
          return () => null;
        },
      }),
      { global: { plugins: [[VueQueryPlugin, { queryClient: new QueryClient() }]] } },
    );
    mounted.push(wrapper);

    return wrapper;
  };

  beforeEach(() => {
    unreadCount.value = undefined;
    setAppBadge.mockClear();
    clearAppBadge.mockClear();
    Object.defineProperty(navigator, 'setAppBadge', { configurable: true, value: setAppBadge });
    Object.defineProperty(navigator, 'clearAppBadge', { configurable: true, value: clearAppBadge });
  });

  afterEach(() => {
    mounted.splice(0).forEach((wrapper) => wrapper.unmount());
    Reflect.deleteProperty(navigator, 'setAppBadge');
    Reflect.deleteProperty(navigator, 'clearAppBadge');
  });

  it('does not touch the badge before the count has loaded', () => {
    mountBadge();

    expect(setAppBadge).not.toHaveBeenCalled();
    expect(clearAppBadge).not.toHaveBeenCalled();
  });

  it('follows the polled count and clears at zero', async () => {
    unreadCount.value = 2;
    mountBadge();
    await vi.waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(2));

    unreadCount.value = 5;
    await vi.waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(5));

    unreadCount.value = 0;
    await vi.waitFor(() => expect(clearAppBadge).toHaveBeenCalledOnce());
  });

  it('clears the badge when the layout unmounts', async () => {
    unreadCount.value = 4;
    const wrapper = mountBadge();
    await vi.waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(4));

    wrapper.unmount();

    await vi.waitFor(() => expect(clearAppBadge).toHaveBeenCalledOnce());
  });
});
