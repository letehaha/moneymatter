import { type NotificationStruct, getNotificationById } from '@/api/notifications';
import { isNotificationsPopoverOpen } from '@/composable/global-state/notifications-popover';
import { ROUTES_NAMES } from '@/routes/constants';
import { NOTIFICATION_STATUSES, NOTIFICATION_TYPES } from '@bt/shared/types';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { useOpenNotification } from './use-open-notification';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  markAsRead: vi.fn(),
  addErrorNotification: vi.fn(),
}));

vi.mock('@/api/notifications', () => ({ getNotificationById: vi.fn() }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/notification-center', () => ({
  useNotificationCenter: () => ({ addErrorNotification: mocks.addErrorNotification }),
}));
vi.mock('@/composable/data-queries/notifications', () => ({
  useMarkNotificationAsRead: () => ({ mutate: mocks.markAsRead }),
}));

const buildNotification = (overrides: Partial<NotificationStruct> = {}): NotificationStruct =>
  ({
    id: 'n-1',
    type: NOTIFICATION_TYPES.subscriptionReminder,
    title: 'Payment reminder: Apple Music',
    message: null,
    payload: { subscriptionId: 'sub-1' },
    status: NOTIFICATION_STATUSES.unread,
    ...overrides,
  }) as NotificationStruct;

const setup = () => {
  let result!: ReturnType<typeof useOpenNotification>;

  mount(
    defineComponent({
      setup() {
        result = useOpenNotification();
        return () => null;
      },
    }),
  );

  return result;
};

describe('useOpenNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNotificationsPopoverOpen.value = false;
  });

  describe('openNotification', () => {
    it('marks an unread notification read and routes to its target', () => {
      const { openNotification } = setup();

      const routed = openNotification({ notification: buildNotification() });

      expect(routed).toBe(true);
      expect(mocks.markAsRead).toHaveBeenCalledWith({ id: 'n-1' });
      expect(mocks.push).toHaveBeenCalledWith(
        expect.objectContaining({ name: ROUTES_NAMES.plannedSubscriptionDetails }),
      );
    });

    it('does not mark a read notification again', () => {
      const { openNotification } = setup();

      openNotification({ notification: buildNotification({ status: NOTIFICATION_STATUSES.read }) });

      expect(mocks.markAsRead).not.toHaveBeenCalled();
      expect(mocks.push).toHaveBeenCalledOnce();
    });

    it('replaces the current entry when asked to', () => {
      const { openNotification } = setup();

      openNotification({ notification: buildNotification(), replace: true });

      expect(mocks.replace).toHaveBeenCalledOnce();
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it('marks a notification without a target read and reports that nothing was routed', () => {
      const { openNotification } = setup();

      const routed = openNotification({ notification: buildNotification({ type: NOTIFICATION_TYPES.system }) });

      expect(routed).toBe(false);
      expect(mocks.markAsRead).toHaveBeenCalledWith({ id: 'n-1' });
      expect(mocks.push).not.toHaveBeenCalled();
    });
  });

  describe('openNotificationById', () => {
    it('loads the notification and routes through its target', async () => {
      vi.mocked(getNotificationById).mockResolvedValue(buildNotification());
      const { openNotificationById } = setup();

      await openNotificationById({ id: 'n-1' });

      expect(getNotificationById).toHaveBeenCalledWith({ id: 'n-1' });
      expect(mocks.markAsRead).toHaveBeenCalledWith({ id: 'n-1' });
      expect(mocks.push).toHaveBeenCalledWith(
        expect.objectContaining({ name: ROUTES_NAMES.plannedSubscriptionDetails }),
      );
    });

    it('opens the bell on the dashboard for a type without a target', async () => {
      vi.mocked(getNotificationById).mockResolvedValue(buildNotification({ type: NOTIFICATION_TYPES.system }));
      const { openNotificationById } = setup();

      await openNotificationById({ id: 'n-1', replace: true });

      expect(mocks.markAsRead).toHaveBeenCalledWith({ id: 'n-1' });
      expect(mocks.replace).toHaveBeenCalledWith({ name: ROUTES_NAMES.home });
      expect(isNotificationsPopoverOpen.value).toBe(true);
    });

    // The backend answers 200 with a null response for an unknown id and for another account's id.
    it('shows a toast and the dashboard when the lookup resolves null, marking nothing read', async () => {
      vi.mocked(getNotificationById).mockResolvedValue(null);
      const { openNotificationById } = setup();

      await openNotificationById({ id: 'someone-elses' });

      expect(mocks.addErrorNotification).toHaveBeenCalledWith('notifications.notFound');
      expect(mocks.push).toHaveBeenCalledWith({ name: ROUTES_NAMES.home });
      expect(mocks.markAsRead).not.toHaveBeenCalled();
      expect(isNotificationsPopoverOpen.value).toBe(false);
    });

    it('shows the same toast and the dashboard when the request rejects', async () => {
      vi.mocked(getNotificationById).mockRejectedValue(new Error('network'));
      const { openNotificationById } = setup();

      await openNotificationById({ id: 'n-1', replace: true });

      expect(mocks.addErrorNotification).toHaveBeenCalledWith('notifications.notFound');
      expect(mocks.replace).toHaveBeenCalledWith({ name: ROUTES_NAMES.home });
      expect(mocks.markAsRead).not.toHaveBeenCalled();
    });
  });
});
