import type { DashboardWidgetConfig } from '@/api/user-settings';
import { DEFAULT_DASHBOARD_LAYOUT } from '@/components/widgets/widget-registry';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

const settings = ref<{ dashboard?: { widgets: DashboardWidgetConfig[] } } | null>(null);
const patchAsync = vi.fn();

vi.mock('@/composable/data-queries/user-settings', () => ({
  useUserSettings: () => ({ data: settings, patchAsync }),
}));

vi.mock('@/lib/posthog', () => ({ trackAnalyticsEvent: vi.fn() }));

import { useDashboardLayout } from './use-dashboard-layout';

describe('useDashboardLayout.saveWidgetConfigDirect', () => {
  beforeEach(() => {
    patchAsync.mockReset();
  });

  it('saves config on top of the default layout when no layout is saved yet', async () => {
    settings.value = { dashboard: { widgets: [] } };
    const widgetId = DEFAULT_DASHBOARD_LAYOUT[0]!.widgetId;

    await useDashboardLayout().saveWidgetConfigDirect({ widgetId, config: { spikesEnabled: false } });

    expect(patchAsync).toHaveBeenCalledTimes(1);
    const { widgets } = patchAsync.mock.calls[0]![0].dashboard;
    expect(widgets).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.length);
    expect(widgets.find((w: DashboardWidgetConfig) => w.widgetId === widgetId).config).toMatchObject({
      spikesEnabled: false,
    });
  });
});
