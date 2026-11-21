import type { DashboardWidgetConfig } from '@/api/user-settings';
import { DEFAULT_DASHBOARD_LAYOUT, WIDGET_REGISTRY } from '@/components/widgets/widget-registry';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import { trackAnalyticsEvent } from '@/lib/posthog';
import { useLocalStorage } from '@vueuse/core';
import { cloneDeep } from 'lodash-es';
import { computed, ref, watch } from 'vue';

export function useDashboardLayout() {
  const { data: settings, patchAsync } = useUserSettings();

  const cachedLayout = useLocalStorage<DashboardWidgetConfig[]>('dashboard-layout', DEFAULT_DASHBOARD_LAYOUT);

  const isEditMode = ref(false);
  const draftWidgets = ref<DashboardWidgetConfig[]>([]);

  const activeWidgets = computed<DashboardWidgetConfig[]>(() => {
    const saved = settings.value?.dashboard?.widgets;

    if (settings.value) {
      // Settings loaded — use API data or default
      const layout = saved && saved.length > 0 ? saved : DEFAULT_DASHBOARD_LAYOUT;
      return layout.filter((w) => w.widgetId in WIDGET_REGISTRY);
    }

    // Still loading — use cached layout for accurate skeletons
    return cachedLayout.value.filter((w) => w.widgetId in WIDGET_REGISTRY);
  });

  watch(activeWidgets, (layout) => {
    if (settings.value) {
      cachedLayout.value = layout;
    }
  });

  const displayWidgets = computed(() => (isEditMode.value ? draftWidgets.value : activeWidgets.value));

  const availableWidgets = computed(() => {
    const currentIds = new Set(draftWidgets.value.map((w) => w.widgetId));
    return Object.values(WIDGET_REGISTRY).filter((def) => !currentIds.has(def.id));
  });

  const enterEditMode = () => {
    draftWidgets.value = cloneDeep(activeWidgets.value);
    isEditMode.value = true;
    trackAnalyticsEvent({ event: 'dashboard_edit_opened' });
  };

  const saveLayout = async () => {
    await patchAsync({ dashboard: { widgets: draftWidgets.value } });
    trackAnalyticsEvent({
      event: 'dashboard_layout_saved',
      properties: { widget_count: draftWidgets.value.length },
    });
    isEditMode.value = false;
  };

  const cancelEdit = () => {
    draftWidgets.value = [];
    isEditMode.value = false;
  };

  const removeWidget = ({ widgetId }: { widgetId: string }) => {
    draftWidgets.value = draftWidgets.value.filter((w) => w.widgetId !== widgetId);
  };

  const addWidget = ({ widgetId }: { widgetId: string }) => {
    const def = WIDGET_REGISTRY[widgetId];
    if (!def) return;
    draftWidgets.value.push({ widgetId, colSpan: def.defaultColSpan, rowSpan: def.defaultRowSpan });
  };

  const resizeWidget = ({ widgetId, colSpan, rowSpan }: { widgetId: string; colSpan: number; rowSpan: number }) => {
    const widget = draftWidgets.value.find((w) => w.widgetId === widgetId);
    if (widget) {
      widget.colSpan = colSpan;
      widget.rowSpan = rowSpan;
    }
  };

  const updateWidgetConfig = ({ widgetId, key, value }: { widgetId: string; key: string; value: unknown }) => {
    const widget = draftWidgets.value.find((w) => w.widgetId === widgetId);
    if (widget) {
      widget.config = { ...widget.config, [key]: value };
    }
  };

  const saveWidgetConfigDirect = async ({
    widgetId,
    config,
  }: {
    widgetId: string;
    config: Record<string, unknown>;
  }) => {
    if (!settings.value) return;

    const widgets = cloneDeep(activeWidgets.value);
    const widget = widgets.find((w) => w.widgetId === widgetId);
    if (widget) {
      widget.config = { ...widget.config, ...config };
      await patchAsync({ dashboard: { widgets } });
      trackAnalyticsEvent({
        event: 'dashboard_widget_config_saved',
        properties: { widget_id: widgetId },
      });
    }
  };

  return {
    isEditMode,
    activeWidgets,
    draftWidgets,
    displayWidgets,
    availableWidgets,
    enterEditMode,
    saveLayout,
    cancelEdit,
    removeWidget,
    addWidget,
    resizeWidget,
    updateWidgetConfig,
    saveWidgetConfigDirect,
  };
}
