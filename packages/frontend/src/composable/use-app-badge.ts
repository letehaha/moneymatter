import { useUnreadNotificationsCount } from '@/composable/data-queries/notifications';
import { onScopeDispose, watch } from 'vue';

interface BadgeNavigator {
  setAppBadge?: (count: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Sets the app icon badge to `count`, or clears it at zero. A no-op where the Badging API is missing. */
export const syncAppBadge = async ({
  count,
  nav = navigator as BadgeNavigator,
}: {
  count: number;
  nav?: BadgeNavigator;
}): Promise<void> => {
  if (!nav.setAppBadge) return;

  try {
    if (count > 0) await nav.setAppBadge(count);
    else await (nav.clearAppBadge ? nav.clearAppBadge() : nav.setAppBadge(0));
  } catch {
    // The badge is decoration; permission or an uninstalled app can reject it.
  }
};

/** Keeps the app icon badge in step with the polled unread count. */
export const useAppBadge = () => {
  const { data: unreadCount } = useUnreadNotificationsCount();

  watch(
    unreadCount,
    (count) => {
      if (typeof count === 'number') void syncAppBadge({ count });
    },
    { immediate: true },
  );

  // Leaving the signed-in layout (sign-out) must not leave the previous account's count on the icon.
  onScopeDispose(() => {
    void syncAppBadge({ count: 0 });
  });
};
