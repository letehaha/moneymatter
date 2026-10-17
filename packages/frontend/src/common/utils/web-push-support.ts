import { useSafariDetection } from '@/composable/detect-safari';

/**
 * - `unsupported`: no service worker or no Push API (an iOS tab has neither a usable one).
 * - `needs-home-screen`: iOS/iPadOS Safari outside the installed Home Screen app, where push is not offered.
 * - `default` / `denied` / `granted`: the browser's notification permission.
 */
export type PushSupport = 'unsupported' | 'needs-home-screen' | 'default' | 'denied' | 'granted';

interface PushWindow {
  navigator: { serviceWorker?: unknown };
  PushManager?: unknown;
  Notification?: { permission: NotificationPermission };
}

interface PushDetection {
  isPWA: boolean;
  isIOS: boolean;
}

export const getPushSupport = ({
  win = window,
  detection = useSafariDetection(),
}: {
  win?: PushWindow;
  detection?: PushDetection;
} = {}): PushSupport => {
  if (detection.isIOS && !detection.isPWA) return 'needs-home-screen';

  if (!win.navigator.serviceWorker || !win.PushManager || !win.Notification) return 'unsupported';

  return win.Notification.permission;
};
