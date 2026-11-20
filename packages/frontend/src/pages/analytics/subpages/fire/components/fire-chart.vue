<template>
  <div class="flex flex-col gap-3">
    <div ref="containerRef" class="relative h-72 w-full">
      <svg ref="svgRef" class="h-full w-full" role="img" :aria-label="$t('analytics.fire.chart.ariaLabel')" />

      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip class="min-w-48">
          <ChartTooltipHeader>{{ tooltip.dateLabel }}</ChartTooltipHeader>
          <ChartTooltipRow
            :label="tooltip.projected ? $t('analytics.fire.chart.projected') : $t('analytics.fire.chart.actual')"
            :value="formatWholeBaseCurrency(tooltip.value)"
          />
          <ChartTooltipRow
            v-if="tooltip.range"
            :label="$t('analytics.fire.chart.range')"
            :value="`${formatWholeBaseCurrency(tooltip.range.low)} – ${formatWholeBaseCurrency(tooltip.range.high)}`"
          />
          <ChartTooltipRow
            v-if="tooltip.forecast !== null && pace"
            :label="$t('analytics.fire.chart.forecast', { month: pace.anchorLabel })"
            :value="formatWholeBaseCurrency(tooltip.forecast)"
          />
        </ChartTooltip>
      </div>
    </div>
    <div v-if="pace" class="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs">
      <span class="inline-flex items-center gap-1.5">
        <span :class="cn('h-0.75 w-4 rounded-full', PACE_SWATCH_CLASS[pace.tone])" />
        {{ $t('analytics.fire.chart.actualSince', { month: pace.anchorLabel }) }}
      </span>
      <span v-if="pace.forecast.length > 0" class="inline-flex items-center gap-1.5">
        <span class="border-foreground/60 w-4 border-t-[3px] border-dotted" />
        {{ $t('analytics.fire.chart.forecast', { month: pace.anchorLabel }) }}
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
import type { FireChart, FireChartPoint } from '@/composable/fire/build-fire-plan';
import { type FireChartPace, PACE_SWATCH_CLASS } from '@/composable/fire/fire-pace-display';
import { useDateLocale } from '@/composable/use-date-locale';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { cn } from '@/lib/utils';
import { differenceInCalendarYears, startOfMonth } from 'date-fns';
import { reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { shapeFireChart } from '@/composable/fire/fire-display';

const props = defineProps<{ chart: FireChart; targetName: string; pace?: FireChartPace | null }>();

const { t, locale } = useI18n();
const { format } = useDateLocale();
const { formatWholeBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const MOBILE_BREAKPOINT_PX = 400;
const HISTORY_AREA_OPACITY = 0.18;
const BAND_OPACITY = 0.12;
const Y_HEADROOM = 1.08;
const LABEL_EDGE_PX = 70;

const containerRef = ref<HTMLElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  dateLabel: '',
  value: 0,
  projected: false,
  range: null as { low: number; high: number } | null,
  forecast: null as number | null,
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const compact = (value: number) => formatAxisCurrency({ value: Math.round(value), symbol: getCurrencySymbol() });

const renderChart = () => {
  if (!svgRef.value || !containerRef.value) return;

  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const { history, projection, band, dots, fireDot } = shapeFireChart({ chart: props.chart });
  const today = projection[0];
  if (!today) return;

  const colors = getChartColors();
  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < MOBILE_BREAKPOINT_PX;
  const fontSize = isMobile ? '10px' : '11px';
  const margin = { top: 20, right: isMobile ? 12 : 20, bottom: 28, left: isMobile ? 44 : 60 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const start = history[0]?.date ?? today.date;
  const end = projection[projection.length - 1]!.date;
  const xScale = d3.scaleTime().domain([start, end]).range([0, innerWidth]);
  const pace = props.pace ?? null;
  const forecast = pace ? pace.forecast.filter((p) => p.date >= start && p.date <= end) : [];
  const forecastByMonth = new Map(forecast.map((p) => [startOfMonth(p.date).getTime(), p.value]));

  const values = [
    ...history.map((p) => p.value),
    ...projection.map((p) => p.value),
    ...band.map((b) => b.high),
    ...forecast.map((p) => p.value),
    props.chart.targetLine,
  ];
  const yScale = d3
    .scaleLinear()
    .domain([Math.min(0, d3.min(values) ?? 0), (d3.max(values) ?? 0) * Y_HEADROOM])
    .nice()
    .range([innerHeight, 0]);

  const x = (p: { date: Date }) => xScale(p.date);
  const line = d3
    .line<FireChartPoint>()
    .x(x)
    .y((p) => yScale(p.value));

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(5)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((grid) => {
      grid.select('.domain').remove();
      grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
    });

  if (band.length > 0) {
    g.append('path')
      .datum(band)
      .attr('fill', colors.primary)
      .attr('fill-opacity', BAND_OPACITY)
      .attr(
        'd',
        d3
          .area<(typeof band)[number]>()
          .x(x)
          .y0((b) => yScale(b.low))
          .y1((b) => yScale(b.high)),
      );
  }

  if (history.length > 0) {
    g.append('path')
      .datum(history)
      .attr('fill', colors.primary)
      .attr('fill-opacity', HISTORY_AREA_OPACITY)
      .attr(
        'd',
        d3
          .area<FireChartPoint>()
          .x(x)
          .y0(yScale(0))
          .y1((p) => yScale(p.value)),
      );
    g.append('path')
      .datum(history)
      .attr('fill', 'none')
      .attr('stroke', colors.primary)
      .attr('stroke-width', 2.5)
      .attr('stroke-linejoin', 'round')
      .attr('d', line);
  }

  g.append('path')
    .datum(projection)
    .attr('fill', 'none')
    .attr('stroke', colors.primary)
    .attr('stroke-width', 2.5)
    .attr('stroke-dasharray', '6 5')
    .attr('stroke-linejoin', 'round')
    .attr('d', line);

  if (pace) {
    const paceColor = { success: colors.successText, primary: colors.primary, warning: colors.warningText }[pace.tone];
    if (forecast.length > 1) {
      g.append('path')
        .datum(forecast)
        .attr('fill', 'none')
        .attr('stroke', colors.foreground)
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', 2.5)
        .attr('stroke-dasharray', '0.5 6')
        .attr('stroke-linecap', 'round')
        .attr('d', line);
    }
    const anchorMonth = startOfMonth(pace.anchorDate);
    const sinceAnchor = history.filter((p) => p.date >= anchorMonth);
    if (sinceAnchor.length > 1) {
      g.append('path')
        .datum(sinceAnchor)
        .attr('fill', 'none')
        .attr('stroke', paceColor)
        .attr('stroke-width', 3)
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round')
        .attr('d', line);
    }
  }

  const targetY = yScale(props.chart.targetLine);
  g.append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', targetY)
    .attr('y2', targetY)
    .attr('stroke', colors.successText)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '5 4');
  g.append('text')
    .attr('x', 4)
    .attr('y', targetY - 6)
    .attr('fill', colors.successText)
    .attr('font-size', fontSize)
    .attr('font-weight', 700)
    .attr('stroke', colors.card)
    .attr('stroke-width', 4)
    .attr('paint-order', 'stroke')
    .text(t('analytics.fire.chart.typeTarget', { type: props.targetName, amount: compact(props.chart.targetLine) }));

  const todayX = x(today);
  g.append('line')
    .attr('x1', todayX)
    .attr('x2', todayX)
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .attr('stroke', colors.text)
    .attr('stroke-dasharray', '3 3');
  g.append('text')
    .attr('x', todayX)
    .attr('y', -8)
    .attr('text-anchor', 'middle')
    .attr('fill', colors.text)
    .attr('font-size', fontSize)
    .attr('font-weight', 600)
    .text(t('analytics.fire.chart.today'));

  for (const { pct, month } of dots) {
    const point = projection[month]!;
    g.append('circle')
      .attr('cx', x(point))
      .attr('cy', yScale(point.value))
      .attr('r', 5)
      .attr('fill', colors.card)
      .attr('stroke', colors.primary)
      .attr('stroke-width', 2);
    g.append('text')
      .attr('x', x(point))
      .attr('y', yScale(point.value) + 18)
      .attr('text-anchor', 'middle')
      .attr('fill', colors.text)
      .attr('font-size', '10px')
      .attr('font-weight', 700)
      .text(`${pct}%`);
  }

  if (fireDot) {
    const fx = x(fireDot);
    const fy = yScale(fireDot.value);
    g.append('circle')
      .attr('cx', fx)
      .attr('cy', fy)
      .attr('r', 7)
      .attr('fill', colors.primary)
      .attr('stroke', colors.card)
      .attr('stroke-width', 2.5);
    g.append('text')
      .attr('x', fx)
      .attr('y', fy + 22)
      .attr('text-anchor', fx > innerWidth - LABEL_EDGE_PX ? 'end' : 'middle')
      .attr('fill', colors.foreground)
      .attr('font-size', fontSize)
      .attr('font-weight', 800)
      .attr('stroke', colors.card)
      .attr('stroke-width', 4)
      .attr('paint-order', 'stroke')
      .text(t('analytics.fire.chart.typeLabel', { type: props.targetName, date: format(fireDot.date, 'LLL yyyy') }));
  }

  const forecastFire = pace?.forecast.at(-1) ?? null;
  if (pace && forecastFire && forecastFire.date <= end) {
    const px = x(forecastFire);
    const py = yScale(forecastFire.value);
    g.append('circle')
      .attr('cx', px)
      .attr('cy', py)
      .attr('r', 5)
      .attr('fill', colors.card)
      .attr('stroke', colors.foreground)
      .attr('stroke-width', 2);
    g.append('text')
      .attr('x', px)
      .attr('y', py - 12)
      .attr('text-anchor', px > innerWidth - LABEL_EDGE_PX ? 'end' : 'middle')
      .attr('fill', colors.text)
      .attr('font-size', fontSize)
      .attr('font-weight', 600)
      .attr('stroke', colors.card)
      .attr('stroke-width', 4)
      .attr('paint-order', 'stroke')
      .text(
        t('analytics.fire.chart.forecastLabel', {
          month: pace.anchorLabel,
          date: format(forecastFire.date, 'LLL yyyy'),
        }),
      );
  }

  const maxTicks = isMobile ? 4 : 8;
  const yearStep = Math.max(1, Math.ceil(differenceInCalendarYears(end, start) / maxTicks));
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom<Date>(xScale)
        .ticks(d3.timeYear.every(yearStep))
        .tickFormat((date) => format(date, 'yyyy')),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid);
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
      axis.selectAll('.tick line').attr('stroke', colors.grid);
    });

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(5)
        .tickFormat((value) => compact(value as number)),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick line').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
    });

  const points = [
    ...history.map((p) => ({ ...p, projected: false, month: -1 })),
    ...projection.slice(1).map((p, i) => ({ ...p, projected: true, month: i + 1 })),
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
      const bandPoint = point.projected ? band[point.month] : undefined;
      tooltip.dateLabel = format(point.date, 'LLL yyyy');
      tooltip.value = point.value;
      tooltip.projected = point.projected;
      tooltip.range = bandPoint ? { low: bandPoint.low, high: bandPoint.high } : null;
      tooltip.forecast = forecastByMonth.get(startOfMonth(point.date).getTime()) ?? null;
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('pointerleave', () => {
      tooltip.visible = false;
      hoverDot.style('opacity', 0);
    });
};

useResizeObserver(containerRef, renderChart);

watch([() => props.chart, () => props.pace, currentTheme, locale], renderChart, { flush: 'post' });
</script>
