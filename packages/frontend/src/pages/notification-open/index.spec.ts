import { type NotificationStruct, getNotificationById } from '@/api/notifications';
import { ROUTES_NAMES } from '@/routes/constants';
import { NOTIFICATION_STATUSES, NOTIFICATION_TYPES } from '@bt/shared/types';
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import NotificationOpenPage from './index.vue';

const addErrorNotification = vi.fn();

vi.mock('@/api/notifications', () => ({
  getNotificationById: vi.fn(),
  markAsRead: vi.fn().mockResolvedValue(true),
}));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification }),
}));

const Blank = { template: '<div />' };

const mountPage = async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/dashboard', name: ROUTES_NAMES.home, component: Blank },
      { path: '/notifications/:id', name: ROUTES_NAMES.notificationOpen, component: NotificationOpenPage },
      { path: '/planned/subscriptions/:id', name: ROUTES_NAMES.plannedSubscriptionDetails, component: Blank },
    ],
  });
  await router.push('/notifications/n-1');
  await router.isReady();

  const wrapper = mount(NotificationOpenPage, {
    global: { plugins: [router, [VueQueryPlugin, { queryClient: new QueryClient() }]] },
  });

  return { router, wrapper };
};

describe('notification-open page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a skeleton while the notification resolves', async () => {
    vi.mocked(getNotificationById).mockReturnValue(new Promise(() => undefined));

    const { wrapper } = await mountPage();

    expect(wrapper.find('[aria-busy="true"]').exists()).toBe(true);
    expect(getNotificationById).toHaveBeenCalledWith({ id: 'n-1' });
  });

  it('replaces itself with the notification target', async () => {
    vi.mocked(getNotificationById).mockResolvedValue({
      id: 'n-1',
      type: NOTIFICATION_TYPES.subscriptionReminder,
      status: NOTIFICATION_STATUSES.read,
      payload: { subscriptionId: 'sub-1' },
    } as unknown as NotificationStruct);

    const { router } = await mountPage();
    await flushPromises();

    expect(router.currentRoute.value.name).toBe(ROUTES_NAMES.plannedSubscriptionDetails);
  });

  // The backend answers 200 with a null body for an unknown id and for another account's id.
  it('leaves for the dashboard with a toast when the lookup resolves null, so it cannot stay on the skeleton', async () => {
    vi.mocked(getNotificationById).mockResolvedValue(null);

    const { router } = await mountPage();
    await flushPromises();

    expect(addErrorNotification).toHaveBeenCalledWith('notifications.notFound');
    expect(router.currentRoute.value.name).toBe(ROUTES_NAMES.home);
  });

  it('leaves for the dashboard with the same toast when the lookup rejects', async () => {
    vi.mocked(getNotificationById).mockRejectedValue(new Error('401'));

    const { router } = await mountPage();
    await flushPromises();

    expect(addErrorNotification).toHaveBeenCalledWith('notifications.notFound');
    expect(router.currentRoute.value.name).toBe(ROUTES_NAMES.home);
  });
});
