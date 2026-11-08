import { useNotificationCenter } from '@/components/notification-center';
import { type EnableResult, useWebPush } from '@/composable/use-web-push';
import { useI18n } from 'vue-i18n';

const TOAST_KEY_PREFIX = 'settings.notifications.thisDevice.toasts';

/**
 * The enable and disable actions with their toasts, shared by the toggle and the empty state of
 * the device list. `turnOn` calls `enable()` before anything else, so the browser's permission
 * prompt still counts as the answer to the user's tap.
 */
export const usePushActions = () => {
  const { enable, disable } = useWebPush();
  const { t } = useI18n();
  const { addSuccessNotification, addErrorNotification, addInfoNotification } = useNotificationCenter();

  const turnOn = async (): Promise<void> => {
    const result: EnableResult = await enable();

    switch (result) {
      case 'enabled':
        addSuccessNotification(t(`${TOAST_KEY_PREFIX}.enabled`));
        break;
      case 'denied':
        addErrorNotification(t(`${TOAST_KEY_PREFIX}.denied`));
        break;
      case 'dismissed':
        addInfoNotification(t(`${TOAST_KEY_PREFIX}.dismissed`));
        break;
      case 'tap-again':
        addInfoNotification(t(`${TOAST_KEY_PREFIX}.tapAgain`));
        break;
      case 'failed':
        addErrorNotification(t(`${TOAST_KEY_PREFIX}.failed`));
        break;
    }
  };

  const turnOff = async (): Promise<void> => {
    try {
      await disable();
      addSuccessNotification(t(`${TOAST_KEY_PREFIX}.disabled`));
    } catch {
      addErrorNotification(t(`${TOAST_KEY_PREFIX}.disableFailed`));
    }
  };

  return { turnOn, turnOff };
};
