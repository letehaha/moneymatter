<template>
  <div ref="containerRef" class="relative h-72 w-full">
    <svg ref="svgRef" class="h-full w-full" />

    <div
      v-show="tooltip.visible"
      ref="tooltipRef"
      class="pointer-events-none absolute z-10"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <ChartTooltip class="min-w-64">
        <ChartTooltipHeader>{{ tooltip.periodLabel }}</ChartTooltipHeader>

        <ChartTooltipHero
          :label="$t('netWorthDrivers.breakdownChart.periodTotal')"
          :value-class="deltaColorClass({ value: tooltip.savedNet + tooltip.growthTotal })"
        >
          {{ formatBaseCurrency(tooltip.savedNet + tooltip.growthTotal) }}
        </ChartTooltipHero>

        <ChartTooltipRow
          :color="seriesColors.saved"
          :label="$t('netWorthDrivers.chart.saved')"
          :value="formatBaseCurrency(tooltip.savedNet)"
          :value-class="deltaColorClass({ value: tooltip.savedNet })"
        />

        <ChartTooltipRow
          :label="$t('netWorthDrivers.breakdownChart.grownTotal')"
          :value="formatBaseCurrency(tooltip.growthTotal)"
          :value-class="deltaColorClass({ value: tooltip.growthTotal })"
        />

        <template v-if="tooltip.segments.length">
          <ChartTooltipDivider />
          <ChartTooltipRow
            v-for="segment in tooltip.segments"
            :key="segment.portfolioId"
            :color="segment.color"
            :label="
              segment.portfolioId === OTHERS_SERIES_ID ? $t('netWorthDrivers.breakdownChart.others') : segment.name
            "
            :value="formatBaseCurrency(segment.growth)"
            :value-class="deltaColorClass({ value: segment.growth })"
          />
        </template>
      </ChartTooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import {
  ChartTooltip,
  ChartTooltipDivider,
  ChartTooltipHeader,
  ChartTooltipHero,
  ChartTooltipRow,
} from '@/components/common/charts/chart-tooltip';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import type { NetWorthDriversGranularity } from '@bt/shared/types';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { parseISO } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';

import {
  type BreakdownBar,
  type BreakdownLegendEntry,
  OTHERS_SERIES_ID,
} from '../composables/net-worth-drivers-derivations';
import { useSeriesColors } from '../composables/use-series-colors';

const props = defineProps<{
  bars: BreakdownBar[];
  legend: BreakdownLegendEntry[];
  granularity: NetWorthDriversGranularity;
}>();

const { format: formatDate, locale } = useDateLocale();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

// Widest the saved+grown pair may grow before it stops reading as one group.
const MAX_GROUP_WIDTH = 72;
const MOBILE_BREAKPOINT_PX = 400;
// Tight enough that the two bars read as a pair rather than two separate periods.
const INNER_BAR_PADDING = 0.12;

type BreakdownSegment = BreakdownBar['segments'][number];

interface ChartBar extends BreakdownBar {
  // Top of the grown bar's up-stack and bottom of its down-stack.
  growthPosSum: number;
  growthNegSum: number;
}

const chartBars = computed<ChartBar[]>(() =>
  props.bars.map((bar) => {
    let growthPosSum = 0;
    let growthNegSum = 0;
    for (const segment of bar.segments) {
      if (segment.growth > 0) growthPosSum += segment.growth;
      else if (segment.growth < 0) growthNegSum += segment.growth;
    }
    return { ...bar, growthPosSum, growthNegSum };
  }),
);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  periodLabel: '',
  savedNet: 0,
  growthTotal: 0,
  segments: [] as BreakdownSegment[],
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const seriesColors = useSeriesColors();

const deltaColorClass = ({ value }: { value: number }) =>
  value < 0 ? 'text-app-expense-color' : value > 0 ? 'text-app-income-color' : '';

const getMargins = ({ width, shouldRotate }: { width: number; shouldRotate: boolean }) => {
  const isMobile = width < MOBILE_BREAKPOINT_PX;
  return {
    top: 12,
    right: isMobile ? 10 : 20,
    left: isMobile ? 40 : 60,
    bottom: shouldRotate ? 70 : 40,
  };
};

const formatAxisLabel = (periodStart: string): string => {
  const date = parseISO(periodStart);
  if (props.granularity === 'yearly') return formatDate(date, 'yyyy');
  if (props.granularity === 'quarterly') return formatDate(date, 'QQQ yy');
  return formatDate(date, 'MMM yy');
};

const formatTooltipPeriodLabel = (periodStart: string): string => {
  const date = parseISO(periodStart);
  if (props.granularity === 'yearly') return formatDate(date, 'yyyy');
  if (props.granularity === 'quarterly') return formatDate(date, 'QQQ yyyy');
  return formatDate(date, 'MMMM yyyy');
};

const formatAxisValue = (value: number) =>
  formatAxisCurrency({ value: Math.round(value), symbol: getCurrencySymbol() });

const renderChart = () => {
  if (!svgRef.value || !containerRef.value) return;

  const { grid, text } = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  if (chartBars.value.length === 0) return;

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < MOBILE_BREAKPOINT_PX;

  const spacePerLabel = width / chartBars.value.length;
  const shouldRotateLabels = spacePerLabel < 55 || chartBars.value.length >= 12;

  const margin = getMargins({ width, shouldRotate: shouldRotateLabels });
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3
    .scaleBand()
    .domain(chartBars.value.map((bar) => bar.periodStart))
    .range([0, innerWidth])
    .padding(0.3);

  const bandwidth = xScale.bandwidth();
  const groupWidth = Math.min(bandwidth, MAX_GROUP_WIDTH);
  const groupOffset = (bandwidth - groupWidth) / 2;

  const innerScale = d3
    .scaleBand<'saved' | 'grown'>()
    .domain(['saved', 'grown'])
    .range([0, groupWidth])
    .padding(INNER_BAR_PADDING);

  // The domain always spans zero and both stacking directions across both bars;
  // all-zero data would collapse it, so the top gets a nominal 1 to keep the axis rendered.
  let domainMax = Math.max(0, d3.max(chartBars.value, (bar) => Math.max(bar.savedNet, bar.growthPosSum)) ?? 0);
  const domainMin = Math.min(0, d3.min(chartBars.value, (bar) => Math.min(bar.savedNet, bar.growthNegSum)) ?? 0);
  if (domainMax === 0 && domainMin === 0) domainMax = 1;

  const yScale = d3.scaleLinear().domain([domainMin, domainMax]).nice().range([innerHeight, 0]);

  g.append('g')
    .attr('class', 'grid')
    .call(
      d3
        .axisLeft(yScale)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((gridAxis) => {
      gridAxis.select('.domain').remove();
      gridAxis.selectAll('.tick line').attr('stroke', grid).attr('stroke-opacity', 0.5);
    });

  const labelRotation = shouldRotateLabels ? -45 : 0;
  const fontSize = isMobile ? '10px' : '12px';

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).tickFormat((value) => formatAxisLabel(value as string)))
    .call((axis) => {
      axis.select('.domain').attr('stroke', grid);
      axis
        .selectAll('.tick text')
        .attr('fill', text)
        .attr('font-size', fontSize)
        .attr('transform', `rotate(${labelRotation})`)
        .attr('text-anchor', shouldRotateLabels ? 'end' : 'middle')
        .attr('dx', shouldRotateLabels ? '-0.5em' : '0')
        .attr('dy', shouldRotateLabels ? '0.5em' : '0.7em');
      axis.selectAll('.tick line').attr('stroke', grid);
    });

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(isMobile ? 5 : 6)
        .tickFormat((value) => formatAxisValue(value as number)),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', grid);
      axis.selectAll('.tick text').attr('fill', text).attr('font-size', fontSize);
      axis.selectAll('.tick line').attr('stroke', grid);
    });

  g.append('line')
    .attr('class', 'zero-line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', yScale(0))
    .attr('y2', yScale(0))
    .attr('stroke', grid)
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');

  const drawRect = ({
    x,
    barWidth,
    value,
    base,
    color,
  }: {
    x: number;
    barWidth: number;
    value: number;
    base: number;
    color: string;
  }) => {
    const top = value > 0 ? yScale(base + value) : yScale(base);
    const bottom = value > 0 ? yScale(base) : yScale(base + value);

    g.append('rect')
      .attr('x', x)
      .attr('y', top)
      .attr('width', barWidth)
      .attr('height', bottom - top)
      .attr('fill', color)
      .style('pointer-events', 'none');
  };

  const barWidth = innerScale.bandwidth();

  chartBars.value.forEach((bar) => {
    const groupX = xScale(bar.periodStart)! + groupOffset;

    if (bar.savedNet !== 0) {
      drawRect({
        x: groupX + innerScale('saved')!,
        barWidth,
        value: bar.savedNet,
        base: 0,
        color: seriesColors.value.saved,
      });
    }

    // Diverging stack: positive portfolios pile up from zero, losing ones pile down,
    // so a mixed period reads as two opposing halves of the same grown bar.
    const grownX = groupX + innerScale('grown')!;
    let posCursor = 0;
    let negCursor = 0;

    bar.segments.forEach((segment) => {
      if (segment.growth === 0) return;

      const base = segment.growth > 0 ? posCursor : negCursor;
      drawRect({ x: grownX, barWidth, value: segment.growth, base, color: segment.color });

      if (segment.growth > 0) posCursor += segment.growth;
      else negCursor += segment.growth;
    });
  });

  // Transparent per-period hit areas span the full band and plot height so the whole
  // group is hoverable, including gaps between diverging segments.
  g.selectAll('.bar-hit')
    .data(chartBars.value)
    .enter()
    .append('rect')
    .attr('class', 'bar-hit')
    .attr('x', (bar) => xScale(bar.periodStart)!)
    .attr('y', 0)
    .attr('width', bandwidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .on('mouseenter', (event: MouseEvent, bar: ChartBar) => {
      tooltip.periodLabel = formatTooltipPeriodLabel(bar.periodStart);
      tooltip.savedNet = bar.savedNet;
      tooltip.growthTotal = bar.growthTotal;
      tooltip.segments = bar.segments.filter((segment) => segment.growth !== 0);
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('mousemove', (event: MouseEvent) => updateTooltipPosition(event))
    .on('mouseleave', () => {
      tooltip.visible = false;
    });
};

useResizeObserver(containerRef, renderChart);

// flush: 'post' lets the SVG container mount/resize before the first draw so it
// reads correct dimensions; deep watch picks up in-place model mutations.
watch([() => props.bars, () => props.legend, () => props.granularity, locale, currentTheme], renderChart, {
  deep: true,
  flush: 'post',
});
</script>
