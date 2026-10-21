import { type NotificationStruct, getNotificationById } from '@/api/notifications';
import { useNotificationCenter } from '@/components/notification-center';
import { buildNotificationRoute } from '@/components/notifications-popover/build-notification-route';
import { useMarkNotificationAsRead } from '@/composable/data-queries/notifications';
import { isNotificationsPopoverOpen } from '@/composable/global-state/notifications-popover';
import { ROUTES_NAMES } from '@/routes/constants';
import { NOTIFICATION_STATUSES } from '@bt/shared/types';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

/**
 * One way to open a notification, shared by the bell (which already holds the row), a click relayed
 * from the service worker and the `/notifications/:id` page (both of which have only the id).
 */
export const useOpenNotification = () => {
  const router = useRouter();
  const { t } = useI18n();
  const { addErrorNotification } = useNotificationCenter();
  const markAsReadMutation = useMarkNotificationAsRead();

  /**
   * Marks an unread notification read and routes to its target.
   * Returns `false` when the type has no target, so the caller decides what to show instead.
   */
  const openNotification = ({
    notification,
    replace = false,
  }: {
    notification: NotificationStruct;
    replace?: boolean;
  }): boolean => {
    if (notification.status === NOTIFICATION_STATUSES.unread) {
      markAsReadMutation.mutate({ id: notification.id });
    }

    const route = buildNotificationRoute(notification);
    if (!route) return false;

    if (route.kind === 'external') {
      window.location.href = route.href;
    } else if (replace) {
      router.replace(route.to);
    } else {
      router.push(route.to);
    }

    return true;
  };

  const showDashboard = ({ replace }: { replace: boolean }) =>
    replace ? router.replace({ name: ROUTES_NAMES.home }) : router.push({ name: ROUTES_NAMES.home });

  /**
   * Loads the notification, then opens it. A missing one (never existed, wiped, another account's)
   * and a failed request both end on the dashboard with a toast. A type with no target ends there
   * too, with the bell open so the user can read it.
   */
  const openNotificationById = async ({ id, replace = false }: { id: string; replace?: boolean }): Promise<void> => {
    let notification: NotificationStruct | null;

    try {
      notification = await getNotificationById({ id });
    } catch {
      notification = null;
    }

    if (!notification) {
      addErrorNotification(t('notifications.notFound'));
      await showDashboard({ replace });
      return;
    }

    if (openNotification({ notification, replace })) return;

    await showDashboard({ replace });
    isNotificationsPopoverOpen.value = true;
  };

  return { openNotification, openNotificationById };
};
