import { useOpenNotification } from '@/composable/use-open-notification';
import { useWebPush } from '@/composable/use-web-push';
import { ROUTES_NAMES } from '@/routes/constants';
import { onBeforeUnmount, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const isAppPath = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//');

/**
 * Receives what the push service worker relays to an open window: a notification click, and the new
 * endpoint after the worker re-subscribed on its own. The click is acknowledged on the message port
 * at once; without that answer the worker navigates the window itself.
 */
export const usePushWorkerMessages = () => {
  const router = useRouter();
  const { openNotificationById } = useOpenNotification();
  const { handleEndpointChanged } = useWebPush();

  const handleMessage = (event: MessageEvent) => {
    const message: unknown = event.data;
    if (typeof message !== 'object' || message === null) return;

    const { type, notificationId, path, endpoint } = message as Record<string, unknown>;

    if (type === 'push-endpoint-changed' && typeof endpoint === 'string') {
      void handleEndpointChanged({ endpoint });
      return;
    }

    if (type === 'notification-click') {
      event.ports[0]?.postMessage('ack');

      if (typeof notificationId === 'string' && notificationId) {
        void openNotificationById({ id: notificationId });
      } else if (isAppPath(path)) {
        void router.push(path);
      } else {
        void router.push({ name: ROUTES_NAMES.home });
      }
    }
  };

  onMounted(() => {
    navigator.serviceWorker?.addEventListener('message', handleMessage);
  });

  onBeforeUnmount(() => {
    navigator.serviceWorker?.removeEventListener('message', handleMessage);
  });

  return { handleMessage };
};
