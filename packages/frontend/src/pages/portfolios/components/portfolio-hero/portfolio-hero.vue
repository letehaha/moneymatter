<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Button } from '@/components/lib/ui/button';
import { Card } from '@/components/lib/ui/card';
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { usePortfolioSummary, usePortfolioValueHistory } from '@/composable/data-queries/portfolio-summary';
import { useResizableWidth } from '@/composable/use-resizable-width';
import { cn } from '@/lib/utils';
import { useElementSize, useLocalStorage } from '@vueuse/core';
import { MoveVerticalIcon, PanelLeftIcon, PictureInPicture2Icon, Settings2Icon, TrendingDownIcon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  CHART_PERIODS,
  type ChartLayout,
  type ChartMode,
  type ChartPeriod,
  buildChartPoints,
  getHistoryRange,
  getPeriodStats,
} from './portfolio-hero-derivations';
import PortfolioHeroStats from './portfolio-hero-stats.vue';
import PortfolioValueChart from './portfolio-value-chart.vue';
import { usePeriodLabels } from './use-period-labels';

const props = defineProps<{ portfolioId: string }>();

const { t } = useI18n();

const NARROW_CONTAINER_PX = 720;
const STACKED_CONTROLS_PX = 560;
const CHART_HEIGHT_PX = { min: 200, max: 800, default: 320 } as const;

const rootRef = ref<HTMLElement | null>(null);
const { width: rootWidth } = useElementSize(rootRef);
const isNarrow = computed(() => rootWidth.value > 0 && rootWidth.value < NARROW_CONTAINER_PX);
const stackPeriods = computed(() => rootWidth.value > 0 && rootWidth.value < STACKED_CONTROLS_PX);

const {
  data: summary,
  isLoading: isSummaryLoading,
  error: summaryError,
  refetch: refetchSummary,
} = usePortfolioSummary(() => props.portfolioId);
const mode = ref<ChartMode>('value');
const storedPeriod = useLocalStorage<ChartPeriod>('portfolio:chart-period', '1Y');
const period = computed<ChartPeriod>({
  get: () => (CHART_PERIODS.includes(storedPeriod.value) ? storedPeriod.value : '1Y'),
  set: (value) => (storedPeriod.value = value),
});
const {
  data: history,
  isLoading: isHistoryLoading,
  isPlaceholderData: isHistoryPlaceholder,
  error: historyError,
  refetch: refetchHistory,
} = usePortfolioValueHistory({
  portfolioId: () => props.portfolioId,
  range: () => getHistoryRange({ period: period.value, today: new Date() }),
});
const storedLayout = useLocalStorage<ChartLayout>('portfolio:chart-layout', 'floating');
const layout = computed<ChartLayout>({
  get: () => (storedLayout.value === 'panel' ? 'panel' : 'floating'),
  set: (value) => (storedLayout.value = value),
});
const series = useLocalStorage(
  'portfolio:chart-series',
  { value: true, netDeposits: true, costBasis: false },
  { mergeDefaults: true },
);
const storedDepositsAxis = useLocalStorage<'shared' | 'own'>('portfolio:chart-deposits-axis', 'shared');
const depositsAxis = computed<'shared' | 'own'>({
  get: () => (storedDepositsAxis.value === 'own' ? 'own' : 'shared'),
  set: (value) => (storedDepositsAxis.value = value),
});
const {
  width: chartMinHeight,
  startResize: startChartResize,
  resetWidth: resetChartHeight,
} = useResizableWidth({
  storageKey: 'portfolio:chart-min-height',
  minWidth: CHART_HEIGHT_PX.min,
  maxWidth: CHART_HEIGHT_PX.max,
  defaultWidth: CHART_HEIGHT_PX.default,
  edge: 'bottom',
});

const periodLabels = usePeriodLabels();

const periodItems = computed(() => CHART_PERIODS.map((value) => ({ value, label: periodLabels.value[value] })));
const modeItems = computed(() => [
  { value: 'value', label: t('portfolioDetail.hero.modes.value') },
  { value: 'return', label: t('portfolioDetail.hero.modes.return') },
]);

const points = computed(() =>
  history.value ? buildChartPoints({ points: history.value.points, period: period.value, today: new Date() }) : [],
);
const hasChart = computed(() => points.value.length >= 2);
const periodStats = computed(() => getPeriodStats({ points: points.value }));
const latestNetDeposits = computed(() => points.value.at(-1)?.netDeposits ?? null);

const layoutItems = computed(() => [
  { value: 'floating' as const, label: t('portfolioDetail.menu.layoutFloating'), icon: PictureInPicture2Icon },
  { value: 'panel' as const, label: t('portfolioDetail.menu.layoutPanel'), icon: PanelLeftIcon },
]);
const depositsAxisItems = computed(() => [
  { value: 'shared' as const, label: t('portfolioDetail.hero.depositsAxis.shared') },
  { value: 'own' as const, label: t('portfolioDetail.hero.depositsAxis.own') },
]);
// Swatches mirror the strokes in portfolio-value-chart.vue.
const seriesItems = computed(() => [
  {
    key: 'value' as const,
    label: t('portfolioDetail.hero.series.value'),
    dash: undefined,
    swatchClass: 'stroke-primary',
  },
  {
    key: 'netDeposits' as const,
    label: t('portfolioDetail.hero.series.netDeposits'),
    dash: '5,5',
    swatchClass: 'stroke-muted-foreground',
  },
  {
    key: 'costBasis' as const,
    label: t('portfolioDetail.hero.series.costBasis'),
    dash: '2,3',
    swatchClass: 'stroke-muted-foreground opacity-70',
  },
]);
const enabledSeriesCount = computed(() => seriesItems.value.filter((item) => series.value[item.key]).length);

const showSummaryError = computed(() => Boolean(summaryError.value) && !summary.value);
const showHistoryError = computed(() => Boolean(historyError.value) && !history.value);
// Stats float inside the chart, so without a chart to host them they render as a regular card.
const isFloating = computed(
  () => layout.value === 'floating' && !isNarrow.value && (isHistoryLoading.value || hasChart.value),
);
const statsProps = computed(() =>
  summary.value
    ? {
        summary: summary.value,
        periodLabel: periodLabels.value[period.value],
        periodStats: periodStats.value,
        netDeposits: latestNetDeposits.value,
        historyCurrencyCode: history.value?.currencyCode ?? summary.value.currencyCode,
      }
    : null,
);
</script>

<template>
  <div ref="rootRef" class="flex flex-col gap-4">
    <div
      v-if="showSummaryError"
      class="bg-card flex flex-col items-center gap-2 rounded-xl border p-6 text-center"
      role="alert"
    >
      <div class="bg-destructive/10 flex size-10 items-center justify-center rounded-full">
        <TrendingDownIcon class="text-destructive-text size-5" />
      </div>
      <p class="text-destructive-text text-sm">{{ $t('portfolioDetail.hero.loadError') }}</p>
      <Button variant="outline" size="sm" @click="refetchSummary()">{{ $t('common.actions.retry') }}</Button>
    </div>

    <div :class="cn('flex gap-4', layout === 'panel' && !isNarrow ? 'flex-row items-stretch' : 'flex-col')">
      <template v-if="!isFloating">
        <PortfolioHeroStats
          v-if="statsProps"
          :variant="layout === 'panel' ? 'panel' : 'card'"
          v-bind="statsProps"
          :class="cn(layout === 'panel' && !isNarrow && 'w-80 shrink-0', isHistoryPlaceholder && 'opacity-60')"
        />
        <div v-else-if="isSummaryLoading" class="bg-muted h-32 animate-pulse rounded-xl" />
      </template>

      <Card class="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div class="flex flex-wrap items-center gap-2">
          <PillTabs
            :model-value="mode"
            :items="modeItems"
            @update:model-value="(value) => (mode = value as ChartMode)"
          />
          <PillTabs
            :model-value="period"
            :items="periodItems"
            :full-width="stackPeriods"
            :class="stackPeriods ? 'order-last' : 'ml-auto'"
            @update:model-value="(value) => (period = value as ChartPeriod)"
          />
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <span :class="cn('inline-flex', stackPeriods && 'ml-auto')">
                <DesktopOnlyTooltip :content="$t('common.actions.settings')">
                  <Button variant="ghost" size="icon-sm" :aria-label="$t('common.actions.settings')">
                    <Settings2Icon class="text-muted-foreground size-4" />
                  </Button>
                </DesktopOnlyTooltip>
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="min-w-60">
              <DropdownMenuLabel class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                {{ $t('portfolioDetail.menu.chartLayout') }}
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                v-for="item in layoutItems"
                :key="item.value"
                :model-value="layout === item.value"
                @update:model-value="layout = item.value"
                @select.prevent
              >
                {{ item.label }}
                <component :is="item.icon" class="text-muted-foreground ml-auto size-4" />
              </DropdownMenuCheckboxItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                {{ $t('portfolioDetail.hero.settings.lines') }}
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                v-for="item in seriesItems"
                :key="item.key"
                v-model="series[item.key]"
                :disabled="series[item.key] && enabledSeriesCount === 1"
                @select.prevent
              >
                {{ item.label }}
                <svg class="ml-auto h-2 w-7 shrink-0" viewBox="0 0 28 8" aria-hidden="true">
                  <line
                    x1="1"
                    y1="4"
                    x2="27"
                    y2="4"
                    stroke-width="2"
                    :stroke-dasharray="item.dash"
                    :class="item.swatchClass"
                  />
                </svg>
              </DropdownMenuCheckboxItem>

              <template v-if="series.netDeposits">
                <DropdownMenuSeparator />
                <DropdownMenuLabel class="text-muted-foreground px-2 py-1.5 text-xs font-medium">
                  {{ $t('portfolioDetail.hero.depositsAxis.label') }}
                </DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  v-for="item in depositsAxisItems"
                  :key="item.value"
                  :model-value="depositsAxis === item.value"
                  @update:model-value="depositsAxis = item.value"
                  @select.prevent
                >
                  {{ item.label }}
                </DropdownMenuCheckboxItem>
              </template>

              <DropdownMenuSeparator />
              <DropdownMenuItem @click="resetChartHeight">
                <MoveVerticalIcon class="size-4" />
                {{ $t('portfolioDetail.menu.resetChartHeight') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div
          v-if="isHistoryLoading || (isFloating && isSummaryLoading)"
          class="bg-muted animate-pulse rounded-lg"
          :style="{ height: `${chartMinHeight}px` }"
        />
        <div
          v-else-if="showHistoryError || !hasChart"
          class="text-muted-foreground flex flex-col items-center justify-center gap-3 text-sm"
          :style="{ height: `${chartMinHeight}px` }"
        >
          {{ showHistoryError ? $t('portfolioDetail.hero.chart.loadError') : $t('portfolioDetail.hero.chart.empty') }}
          <Button v-if="showHistoryError" variant="outline" size="sm" @click="refetchHistory()">
            {{ $t('common.actions.retry') }}
          </Button>
        </div>
        <PortfolioValueChart
          v-else
          :points="points"
          :currency-code="history?.currencyCode ?? summary?.currencyCode ?? ''"
          :mode="mode"
          :series="series"
          :deposits-own-scale="depositsAxis === 'own'"
          :min-height="chartMinHeight"
          :floating-card="isFloating && Boolean(statsProps)"
          :class="cn('transition-opacity', isHistoryPlaceholder && 'pointer-events-none opacity-60')"
        >
          <template #card>
            <PortfolioHeroStats v-if="statsProps" variant="card" v-bind="statsProps" />
          </template>
        </PortfolioValueChart>

        <p v-if="mode === 'return'" class="text-muted-foreground border-t pt-3 text-sm">
          {{ $t('portfolioDetail.hero.chart.returnCaption') }}
        </p>

        <DesktopOnlyTooltip :content="$t('portfolioDetail.hero.resizeHint')">
          <div
            class="group -mt-2 -mb-3 flex h-5 cursor-ns-resize touch-none items-center justify-center"
            @pointerdown.left.prevent="startChartResize"
            @dblclick="resetChartHeight"
          >
            <span class="bg-border group-hover:bg-primary/60 h-1 w-11 rounded-full transition-colors" />
          </div>
        </DesktopOnlyTooltip>
      </Card>
    </div>
  </div>
</template>
