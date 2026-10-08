import type { DashboardWidgetConfig } from '@/api/user-settings';
import { useNotificationCenter } from '@/components/notification-center';
import { i18n } from '@/i18n';
import { ApiErrorResponseError } from '@/js/errors';
import { type Ref, computed, inject } from 'vue';

/**
 * A widget counts pending planned transactions unless its config opts out, so every reader
 * treats a missing key as `true`.
 */
export const readIncludePlanned = ({ config }: { config: Record<string, unknown> | undefined }): boolean =>
  config?.includePlanned !== false;

/**
 * A failed save leaves the switch snapped back to the persisted value, which reads as the
 * toggle being ignored unless the failure is surfaced.
 */
const useConfigSaveError = ({ fallbackKey }: { fallbackKey: string }) => {
  const { addErrorNotification } = useNotificationCenter();

  return ({ error }: { error: unknown }) => {
    if (error instanceof ApiErrorResponseError) {
      addErrorNotification(error.data.message ?? error.message);
    } else {
      // eslint-disable-next-line no-console
      console.error(error);
      addErrorNotification(i18n.global.t(fallbackKey));
    }
  };
};

export const useIncludePlannedSaveError = () =>
  useConfigSaveError({ fallbackKey: 'dashboard.widgets.common.includePlannedSaveError' });

/**
 * Reads and persists one on-by-default boolean of a dashboard widget's config through the
 * shared widget-config injections. A missing key reads as `true`.
 */
export const useWidgetConfigFlag = ({ key, saveErrorKey }: { key: string; saveErrorKey: string }) => {
  const widgetConfigRef = inject<Ref<DashboardWidgetConfig> | null>('dashboard-widget-config', null);
  const saveWidgetConfig =
    inject<(params: { widgetId: string; config: Record<string, unknown> }) => Promise<void>>(
      'dashboard-save-widget-config',
    );

  const notifySaveError = useConfigSaveError({ fallbackKey: saveErrorKey });

  const isOn = computed<boolean>(() => widgetConfigRef?.value?.config?.[key] !== false);

  const setFlag = async ({ value }: { value: boolean }) => {
    if (!saveWidgetConfig || !widgetConfigRef?.value) return;

    try {
      await saveWidgetConfig({
        widgetId: widgetConfigRef.value.widgetId,
        config: { [key]: value },
      });
    } catch (error) {
      notifySaveError({ error });
    }
  };

  return { widgetConfigRef, isOn, setFlag };
};

export const useIncludePlannedConfig = () => {
  const { widgetConfigRef, isOn, setFlag } = useWidgetConfigFlag({
    key: 'includePlanned',
    saveErrorKey: 'dashboard.widgets.common.includePlannedSaveError',
  });

  return { widgetConfigRef, includePlanned: isOn, setIncludePlanned: setFlag };
};
