<template>
  <div class="@container/pivot-report space-y-5">
    <PivotConfigPanel
      v-model:row-dimension="persisted.rowDimension"
      v-model:granularity="persisted.granularity"
      v-model:measure="persisted.measure"
      v-model:period="period"
      v-model:account-ids="persisted.accountIds"
      v-model:category-ids="persisted.categoryIds"
      v-model:payee-ids="persisted.payeeIds"
      v-model:heatmap="persisted.heatmap"
      v-model:show-delta="persisted.showDelta"
      :saved-views="savedViews"
      :active-view-id="activeViewId"
      :is-saving-view="isPatching"
      :can-reset="canReset"
      @save-view="onSaveView"
      @select-view="onSelectView"
      @delete-view="onDeleteView"
      @reset="onResetConfig"
    />

    <!-- Loading state: approximate the pivot grid (header + labelled rows of cells) -->
    <div v-if="query.isLoading.value" class="border-border bg-card space-y-2 rounded-lg border p-3">
      <div class="flex gap-3">
        <div class="bg-muted h-6 w-40 shrink-0 animate-pulse rounded" />
        <div v-for="n in 5" :key="`pivot-skeleton-head-${n}`" class="bg-muted h-6 flex-1 animate-pulse rounded" />
      </div>
      <div v-for="rowIndex in 6" :key="`pivot-skeleton-row-${rowIndex}`" class="flex gap-3">
        <div class="bg-muted h-8 w-40 shrink-0 animate-pulse rounded" />
        <div
          v-for="n in 5"
          :key="`pivot-skeleton-cell-${rowIndex}-${n}`"
          class="bg-muted/60 h-8 flex-1 animate-pulse rounded"
        />
      </div>
    </div>

    <!-- Error state -->
    <div v-else-if="query.isError.value" class="flex h-72 flex-col items-center justify-center gap-2 text-center">
      <TriangleAlertIcon class="text-muted-foreground size-8" />
      <p class="text-destructive-text">{{ $t('pivotReport.states.errorTitle') }}</p>
      <p class="text-muted-foreground text-sm">{{ $t('pivotReport.states.errorHint') }}</p>
      <Button variant="outline" size="sm" @click="query.refetch()">{{ $t('common.actions.retry') }}</Button>
    </div>

    <!-- Empty state -->
    <div
      v-else-if="report && report.rows.length === 0"
      class="flex h-72 flex-col items-center justify-center gap-2 text-center"
    >
      <TableIcon class="text-muted-foreground size-8" />
      <p class="font-medium">{{ $t('pivotReport.states.emptyTitle') }}</p>
      <p class="text-muted-foreground text-sm">{{ $t('pivotReport.states.emptyHint') }}</p>
    </div>

    <!-- Data -->
    <PivotTable
      v-else-if="report"
      :data="report"
      :measure="persisted.measure"
      :row-dimension="persisted.rowDimension"
      :heatmap="persisted.heatmap"
      :show-delta="persisted.showDelta"
      :row-header-label="rowHeaderLabel"
    />
  </div>
</template>

<script setup lang="ts">
import { randomId } from '@/common/utils/random-id';
import Button from '@/components/lib/ui/button/Button.vue';
import { useNotificationCenter } from '@/components/notification-center';
import { useUserSettings } from '@/composable/data-queries/user-settings';
import type { Period } from '@/composable/use-period-navigation';
import type {
  PivotRowDimension,
  PivotGranularity,
  PivotMeasure,
  SavedPivotView,
  SavedPivotViewConfig,
} from '@bt/shared/types';
import { endOfMonth, parse, startOfMonth, subMonths } from 'date-fns';
import { TableIcon, TriangleAlertIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import PivotConfigPanel from './components/pivot-config-panel.vue';
import PivotTable from './components/pivot-table.vue';
import { buildSavedPivotConfig, usePivotReport } from './composables/use-pivot-report';
import { arePivotConfigsEqual, findMatchingViewId } from './composables/pivot-derivations';

interface PivotPersistedConfig {
  rowDimension: PivotRowDimension;
  granularity: PivotGranularity;
  measure: PivotMeasure;
  accountIds: string[];
  categoryIds: string[];
  payeeIds: string[];
  heatmap: boolean;
  showDelta: boolean;
}

const DEFAULT_PERIOD_MONTHS = 12;

const createDefaultConfig = (): PivotPersistedConfig => ({
  rowDimension: 'category',
  granularity: 'monthly',
  measure: 'expense',
  accountIds: [],
  categoryIds: [],
  payeeIds: [],
  heatmap: false,
  showDelta: true,
});

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();

const getDefaultPeriod = (): Period => ({
  from: startOfMonth(subMonths(new Date(), DEFAULT_PERIOD_MONTHS - 1)),
  to: endOfMonth(new Date()),
});

// The report always opens on a clean default configuration — the current layout
// and filters are intentionally NOT persisted across reloads, so a saved view is
// only ever applied when the user explicitly picks it from the Views menu.
const persisted = ref<PivotPersistedConfig>(createDefaultConfig());
const period = ref<Period>(getDefaultPeriod());

const liveConfig = computed(() => ({
  rowDimension: persisted.value.rowDimension,
  granularity: persisted.value.granularity,
  measure: persisted.value.measure,
  period: period.value,
  accountIds: persisted.value.accountIds,
  categoryIds: persisted.value.categoryIds,
  payeeIds: persisted.value.payeeIds,
  heatmap: persisted.value.heatmap,
  showDelta: persisted.value.showDelta,
}));

const { query } = usePivotReport({ config: liveConfig });
const report = computed(() => query.data.value);

const rowHeaderLabel = computed(() => t(`pivotReport.dimensions.${persisted.value.rowDimension}`));

// --- Saved views ---
const { data: settings, patchAsync, isPatching } = useUserSettings();
const savedViews = computed<SavedPivotView[]>(() => settings.value?.savedPivotViews ?? []);

const currentSavedConfig = computed(() => buildSavedPivotConfig({ config: liveConfig.value }));
const activeViewId = computed(() => findMatchingViewId({ config: currentSavedConfig.value, views: savedViews.value }));

// Whether the live config has drifted from a clean default — gates the "Reset"
// pill so it only appears once there is something to reset.
const canReset = computed(
  () =>
    !arePivotConfigsEqual({
      a: currentSavedConfig.value,
      b: buildSavedPivotConfig({ config: { ...createDefaultConfig(), period: getDefaultPeriod() } }),
    }),
);

const onResetConfig = () => {
  persisted.value = createDefaultConfig();
  period.value = getDefaultPeriod();
};

const applySavedConfig = (config: SavedPivotViewConfig) => {
  persisted.value = {
    rowDimension: config.rowDimension,
    granularity: config.granularity,
    measure: config.measure,
    accountIds: config.accountIds ?? [],
    categoryIds: config.categoryIds ?? [],
    payeeIds: config.payeeIds ?? [],
    heatmap: config.heatmap,
    showDelta: config.showDelta,
  };
  // Parse as local midnight so the displayed date matches what was saved.
  period.value = {
    from: parse(config.from, 'yyyy-MM-dd', new Date()),
    to: parse(config.to, 'yyyy-MM-dd', new Date()),
  };
};

const onSaveView = async ({ name }: { name: string }) => {
  try {
    const newView: SavedPivotView = { id: randomId(), name, config: currentSavedConfig.value };
    await patchAsync({ savedPivotViews: [...savedViews.value, newView] });
    addSuccessNotification(t('pivotReport.savedViews.savedToast'));
  } catch {
    addErrorNotification(t('pivotReport.savedViews.saveError'));
  }
};

const onSelectView = ({ id }: { id: string }) => {
  const view = savedViews.value.find((candidate) => candidate.id === id);
  if (view) applySavedConfig(view.config);
};

const onDeleteView = async ({ id }: { id: string }) => {
  try {
    await patchAsync({ savedPivotViews: savedViews.value.filter((view) => view.id !== id) });
    addSuccessNotification(t('pivotReport.savedViews.deletedToast'));
  } catch {
    addErrorNotification(t('pivotReport.savedViews.saveError'));
  }
};
</script>
