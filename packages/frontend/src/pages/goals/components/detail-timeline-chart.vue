<template>
  <div class="flex flex-col">
    <div ref="containerRef" class="relative h-64 w-full">
      <svg ref="svgRef" class="h-full w-full" role="img" :aria-label="$t('goals.details.progress.chartAria')" />

      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none fixed z-50"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>{{ tooltip.dateLabel }}</ChartTooltipHeader>
          <ChartTooltipRow
            color="var(--primary)"
            :label="
              tooltip.projected
                ? $t('goals.details.progress.legend.projection')
                : $t('goals.details.progress.legend.saved')
            "
            :value="formatAmount(tooltip.value)"
          />
          <ChartTooltipRow
            v-if="tooltip.change !== null"
            :label="$t('goals.details.progress.monthlyChange')"
            :value="formatSigned(tooltip.change)"
          />
        </ChartTooltip>
      </div>
    </div>

    <div class="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <span class="flex items-center gap-1.5">
        <i class="bg-primary inline-block h-0.5 w-3" />{{ $t('goals.details.progress.legend.saved') }}
      </span>
      <span v-if="projection.length" class="flex items-center gap-1.5">
        <i class="border-primary inline-block w-3 border-t-2 border-dashed" />{{
          $t('goals.details.progress.legend.projection')
        }}
      </span>
      <span class="flex items-center gap-1.5">
        <i class="border-success-text inline-block w-3 border-t-2 border-dashed" />{{
          $t('goals.details.progress.legend.target')
        }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useDateLocale } from '@/composable/use-date-locale';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { GoalHistoryPoint } from './detail-helpers';

const props = defineProps<{
  history: GoalHistoryPoint[];
  projection: { date: Date; value: number }[];
  target: number;
  currencyCode: string;
}>();

const { locale } = useI18n();
const { format } = useDateLocale();
const { formatWholeOrCompactAmount, formatSignedWholeOrCompactAmount, getCurrencySymbol } = useFormatCurrency();

const formatAmount = (amount: number) => formatWholeOrCompactAmount({ amount, currencyCode: props.currencyCode });
const formatSigned = (amount: number) => formatSignedWholeOrCompactAmount({ amount, currencyCode: props.currencyCode });

const MIN_PX_PER_X_TICK = 90;
const NARROW_WIDTH_PX = 400;
const AREA_OPACITY = 0.15;
const Y_HEADROOM = 1.05;

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  dateLabel: '',
  value: 0,
  change: null as number | null,
  projected: false,
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip, strategy: 'fixed' });

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || props.history.length === 0) return;

  const colors = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const margin = { top: 24, right: 16, bottom: 28, left: width < NARROW_WIDTH_PX ? 52 : 64 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const start = props.history[0]!.date;
  const end = props.projection.at(-1)?.date ?? props.history.at(-1)!.date;
  const xScale = d3.scaleTime().domain([start, end]).range([0, innerWidth]);

  const values = [...props.history.map((p) => p.value), ...props.projection.map((p) => p.value), props.target];
  const yScale = d3
    .scaleLinear()
    .domain([0, (d3.max(values) ?? 0) * Y_HEADROOM || 1])
    .nice()
    .range([innerHeight, 0]);

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(4)
        .tickSize(-innerWidth)
        .tickFormat((d) => formatAxisCurrency({ value: d as number, symbol: getCurrencySymbol(props.currencyCode) })),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
      axis.selectAll('.tick text').attr('fill', colors.text).style('font-size', '12px');
    });

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom<Date>(xScale)
        .ticks(Math.max(2, Math.floor(innerWidth / MIN_PX_PER_X_TICK)))
        .tickSizeOuter(0)
        .tickFormat((d) => format(d, 'MMM yy')),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid);
      axis.selectAll('.tick line').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).style('font-size', '12px');
    });

  const x = (p: { date: Date }) => xScale(p.date);
  const line = d3
    .line<{ date: Date; value: number }>()
    .x(x)
    .y((p) => yScale(p.value));

  g.append('path')
    .datum(props.history)
    .attr('fill', colors.primary)
    .attr('fill-opacity', AREA_OPACITY)
    .attr(
      'd',
      d3
        .area<GoalHistoryPoint>()
        .x(x)
        .y0(yScale(0))
        .y1((p) => yScale(p.value)),
    );
  g.append('path')
    .datum(props.history)
    .attr('fill', 'none')
    .attr('stroke', colors.primary)
    .attr('stroke-width', 2.5)
    .attr('stroke-linejoin', 'round')
    .attr('d', line);

  if (props.projection.length) {
    g.append('path')
      .datum(props.projection)
      .attr('fill', 'none')
      .attr('stroke', colors.primary)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 5')
      .attr('d', line);
  }

  const targetY = yScale(props.target);
  g.append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', targetY)
    .attr('y2', targetY)
    .attr('stroke', colors.successText)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5 4');

  const today = props.history.at(-1)!;
  g.append('circle')
    .attr('cx', x(today))
    .attr('cy', yScale(today.value))
    .attr('r', 4)
    .attr('fill', colors.primary)
    .attr('stroke', colors.card)
    .attr('stroke-width', 2);

  const points = [
    ...props.history.map((p) => ({ ...p, projected: false })),
    ...props.projection.slice(1).map((p) => ({ ...p, change: null, projected: true })),
  ];
  const bisect = d3.bisector((p: { date: Date }) => p.date).center;
  const hoverDot = g
    .append('circle')
    .attr('r', 4)
    .attr('fill', colors.primary)
    .attr('stroke', colors.card)
    .attr('stroke-width', 2)
    .style('opacity', 0);

  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .on('pointermove', (event: PointerEvent) => {
      const [mouseX] = d3.pointer(event);
      const point = points[bisect(points, xScale.invert(mouseX))];
      if (!point) return;
      hoverDot.attr('cx', x(point)).attr('cy', yScale(point.value)).style('opacity', 1);
      tooltip.dateLabel = format(point.date, 'MMMM yyyy');
      tooltip.value = point.value;
      tooltip.change = point.change;
      tooltip.projected = point.projected;
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('pointerleave', () => {
      tooltip.visible = false;
      hoverDot.style('opacity', 0);
    });
};

useResizeObserver(containerRef, renderChart);

watch([() => props, currentTheme, locale], renderChart, { deep: true, flush: 'post' });
</script>
