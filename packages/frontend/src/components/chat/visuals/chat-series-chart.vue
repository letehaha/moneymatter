<script setup lang="ts">
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { useChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useFormatCurrency } from '@/composable';
import type { ChatSeriesChartSpec } from '@bt/shared/types';
import { useResizeObserver } from '@vueuse/core';
import { computed, reactive, ref } from 'vue';

import { buildSeriesChartGeometry } from './chart-geometry';
import { formatVisualAxisDate, formatVisualDate, formatVisualValue } from './format-visual-value';

const props = defineProps<{ spec: ChatSeriesChartSpec }>();

const CHART_HEIGHT = 220;
/** Used until the container has been measured. */
const DEFAULT_WIDTH = 480;
const NO_VALUE = '—';

const colors = useChartColors();
const { getCurrencySymbol } = useFormatCurrency();

const containerRef = ref<HTMLDivElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);
const width = ref(DEFAULT_WIDTH);

useResizeObserver(containerRef, (entries) => {
  const measured = Math.floor(entries[0]?.contentRect.width ?? 0);
  if (measured > 0) width.value = measured;
});

const geometry = computed(() =>
  buildSeriesChartGeometry({ spec: props.spec, size: { width: width.value, height: CHART_HEIGHT } }),
);

const isBars = computed(() => props.spec.kind === 'bar' || props.spec.kind === 'stackedBar');

const formatValue = ({ value }: { value: number }) =>
  formatVisualValue({
    value,
    kind: props.spec.unit.kind,
    currencyCode: props.spec.unit.kind === 'money' ? props.spec.unit.currencyCode : undefined,
  });

const formatTick = ({ value }: { value: number }) => {
  const { unit } = props.spec;
  if (unit.kind === 'percent') return `${value}%`;

  return formatAxisCurrency({ value, symbol: unit.kind === 'money' ? getCurrencySymbol(unit.currencyCode) : '' });
};

const spansYears = computed(() => {
  if (props.spec.xAxis.type !== 'date') return false;
  const years = new Set(props.spec.xAxis.values.map((value) => value.slice(0, 4)));
  return years.size > 1;
});

const formatXTick = ({ index }: { index: number }) => {
  const value = props.spec.xAxis.values[index] ?? '';
  return props.spec.xAxis.type === 'date' ? formatVisualAxisDate({ value, includeYear: spansYears.value }) : value;
};

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  index: 0,
  header: '',
  rows: [] as Array<{ color: string; label: string; value: string }>,
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const showTooltip = ({ index, event }: { index: number; event: PointerEvent }) => {
  const xValue = props.spec.xAxis.values[index] ?? '';
  tooltip.index = index;
  tooltip.header = props.spec.xAxis.type === 'date' ? formatVisualDate({ value: xValue }) : xValue;
  tooltip.rows = geometry.value.series.map((series) => {
    const value = series.points[index]?.value ?? null;
    return { color: series.color, label: series.name, value: value === null ? NO_VALUE : formatValue({ value }) };
  });
  tooltip.visible = true;
  updateTooltipPosition(event);
};

const hideTooltip = () => {
  tooltip.visible = false;
};

/** One hover target per category; every series shares the x positions, so the first one names them. */
const hoverSlots = computed(() => (geometry.value.series[0]?.points ?? []).map(({ index, x }) => ({ index, x })));

const hoverX = computed(() => (tooltip.visible ? (hoverSlots.value[tooltip.index]?.x ?? null) : null));

const hoverDots = computed(() =>
  tooltip.visible && !isBars.value
    ? geometry.value.series.flatMap((series) => {
        const point = series.points[tooltip.index];
        return point && point.y !== null ? [{ color: series.color, x: point.x, y: point.y }] : [];
      })
    : [],
);
</script>

<template>
  <div class="flex flex-col gap-2">
    <div ref="containerRef" class="relative w-full">
      <svg :width="width" :height="CHART_HEIGHT" role="img" :aria-label="spec.title" class="block max-w-full">
        <g>
          <line
            v-for="tick in geometry.yTicks"
            :key="tick.value"
            :x1="geometry.plot.left"
            :x2="geometry.plot.right"
            :y1="tick.y"
            :y2="tick.y"
            :stroke="colors.grid"
            :stroke-opacity="tick.value === 0 ? 1 : 0.5"
          />
          <text
            v-for="tick in geometry.yTicks"
            :key="`y-${tick.value}`"
            :x="geometry.plot.left - 6"
            :y="tick.y"
            dy="0.32em"
            text-anchor="end"
            font-size="11"
            :fill="colors.text"
          >
            {{ formatTick({ value: tick.value }) }}
          </text>
          <text
            v-for="tick in geometry.xTicks"
            :key="`x-${tick.index}`"
            :x="tick.x"
            :y="geometry.plot.bottom + 16"
            text-anchor="middle"
            font-size="11"
            :fill="colors.text"
          >
            {{ formatXTick({ index: tick.index }) }}
          </text>
        </g>

        <line
          v-if="hoverX !== null && !isBars"
          :x1="hoverX"
          :x2="hoverX"
          :y1="geometry.plot.top"
          :y2="geometry.plot.bottom"
          :stroke="colors.text"
          stroke-opacity="0.5"
          stroke-dasharray="3 3"
        />

        <template v-for="series in geometry.series" :key="series.name">
          <path
            v-if="series.areaPath"
            data-testid="chart-area"
            :d="series.areaPath"
            :fill="series.color"
            fill-opacity="0.15"
          />
          <path
            v-if="series.linePath"
            data-testid="chart-line"
            :d="series.linePath"
            :stroke="series.color"
            fill="none"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <g v-if="isBars" data-testid="chart-bars" :fill="series.color">
            <rect
              v-for="bar in series.bars"
              :key="bar.index"
              :x="bar.x"
              :y="bar.y"
              :width="bar.width"
              :height="bar.height"
              rx="2"
            />
          </g>
        </template>

        <circle
          v-for="(dot, dotIndex) in hoverDots"
          :key="`dot-${dotIndex}`"
          :cx="dot.x"
          :cy="dot.y"
          r="3.5"
          :fill="dot.color"
          :stroke="colors.card"
          stroke-width="1.5"
        />

        <rect
          v-for="slot in hoverSlots"
          :key="`hover-${slot.index}`"
          data-testid="chart-hover-slot"
          :x="slot.x - geometry.slotWidth / 2"
          :y="geometry.plot.top"
          :width="geometry.slotWidth"
          :height="geometry.plot.bottom - geometry.plot.top"
          fill="transparent"
          @pointerenter="showTooltip({ index: slot.index, event: $event })"
          @pointermove="showTooltip({ index: slot.index, event: $event })"
          @pointerleave="hideTooltip"
        />
      </svg>

      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        data-testid="chart-tooltip"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>{{ tooltip.header }}</ChartTooltipHeader>
          <ChartTooltipRow
            v-for="row in tooltip.rows"
            :key="row.label"
            :color="row.color"
            :label="row.label"
            :value="row.value"
          />
        </ChartTooltip>
      </div>
    </div>

    <ul data-testid="chart-legend" class="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      <li v-for="series in geometry.series" :key="series.name" class="flex min-w-0 items-center gap-1.5">
        <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: series.color }" />
        <span class="text-muted-foreground truncate">{{ series.name }}</span>
      </li>
    </ul>
  </div>
</template>
