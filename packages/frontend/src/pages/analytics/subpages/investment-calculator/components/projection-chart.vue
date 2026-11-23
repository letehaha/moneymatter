<template>
  <div class="flex flex-col">
    <div ref="containerRef" class="relative h-80 w-full sm:h-100">
      <svg ref="svgRef" data-testid="projection-chart" class="h-full w-full"></svg>

      <!-- Tooltip -->
      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>
            {{ $t('analytics.investmentCalculator.yearN', { n: tooltip.year }) }}
          </ChartTooltipHeader>
          <ChartTooltipRow
            :color="chartColors.nominal"
            :label="indicatorLabel"
            :value="formatBaseCurrency(tooltip.nominal)"
          />
          <ChartTooltipRow
            :color="chartColors.real"
            :label="`${indicatorLabel} ${$t('analytics.investmentCalculator.inflationAdjustedSuffix')}`"
            :value="formatBaseCurrency(tooltip.real)"
          />
          <ChartTooltipRow
            :color="chartColors.totalInvested"
            :label="$t('analytics.investmentCalculator.totalInvested')"
            :value="formatBaseCurrency(tooltip.totalInvested)"
          />
        </ChartTooltip>
      </div>
    </div>

    <!-- Legend -->
    <div data-testid="chart-legend" class="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
      <div class="flex items-center gap-2">
        <span class="inline-block h-0.5 w-4 rounded-full" :style="{ backgroundColor: chartColors.nominal }"></span>
        <span class="text-muted-foreground">{{ indicatorLabel }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="inline-block h-0.5 w-4 rounded-full" :style="{ backgroundColor: chartColors.real }"></span>
        <span class="text-muted-foreground">
          {{ indicatorLabel }} {{ $t('analytics.investmentCalculator.inflationAdjustedSuffix') }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="inline-block h-0.5 w-4 rounded-full border-t-2 border-dashed"
          :style="{ borderColor: chartColors.totalInvested }"
        ></span>
        <span class="text-muted-foreground">{{ $t('analytics.investmentCalculator.totalInvested') }}</span>
      </div>
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
import { areAmountsHidden } from '@/js/helpers/formatters';
import * as d3 from 'd3';
import { useResizeObserver } from '@vueuse/core';
import { reactive, ref, watch } from 'vue';

import type { ProjectionDataPoint } from '../composables/use-projection-calc';

const props = defineProps<{
  data: ProjectionDataPoint[];
  indicatorLabel: string;
}>();

const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  year: 0,
  nominal: 0,
  real: 0,
  totalInvested: 0,
});

const { updateTooltipPosition } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
});

const chartColors = {
  nominal: 'rgb(59, 130, 246)', // blue-500
  real: 'rgb(34, 197, 94)', // green-500
  totalInvested: 'rgb(161, 161, 170)', // zinc-400
};

const getColors = () => {
  const { grid, text } = getChartColors();
  return { grid, text, ...chartColors };
};

const MOBILE_CHART_BREAKPOINT = 400;

const getMargins = ({ width }: { width: number }) => {
  const isMobile = width < MOBILE_CHART_BREAKPOINT;
  return {
    top: 20,
    right: isMobile ? 10 : 20,
    left: isMobile ? 50 : 70,
    bottom: 40,
  };
};

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: getCurrencySymbol() });

/**
 * Compute which year indices to show as X-axis ticks.
 * Adapts granularity based on the time horizon.
 */
const getYearlyTickPoints = (data: ProjectionDataPoint[]): ProjectionDataPoint[] => {
  if (data.length === 0) return [];

  const maxYear = data[data.length - 1]!.year;

  let stepYears: number;
  if (maxYear <= 3) stepYears = 0.5;
  else if (maxYear <= 10) stepYears = 1;
  else if (maxYear <= 20) stepYears = 2;
  else stepYears = 5;

  const stepMonths = stepYears * 12;
  return data.filter((d) => d.month > 0 && d.month % stepMonths === 0);
};

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || props.data.length < 2) return;

  const colors = getColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < MOBILE_CHART_BREAKPOINT;

  const margin = getMargins({ width });
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Scales
  const xScale = d3
    .scaleLinear()
    .domain([0, d3.max(props.data, (d) => d.year) || 1])
    .range([0, innerWidth]);

  const yMax = d3.max(props.data, (d) => d.nominal) || 1;
  const yScale = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

  // Compute tick points (used for vertical grid lines and x-axis)
  const tickPoints = getYearlyTickPoints(props.data);
  const tickYears = tickPoints.map((d) => d.year);
  const fontSize = isMobile ? '10px' : '12px';

  // Horizontal grid lines
  g.append('g')
    .attr('class', 'grid')
    .call(
      d3
        .axisLeft(yScale)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((grid) => {
      grid.select('.domain').remove();
      grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
    });

  // Vertical grid lines (at each year tick)
  g.append('g')
    .attr('class', 'grid-vertical')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(tickYears)
        .tickSize(-innerHeight)
        .tickFormat(() => ''),
    )
    .call((grid) => {
      grid.select('.domain').remove();
      grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
    });

  // X axis

  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(tickYears)
        .tickFormat((d) => `${d}yr`),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid);
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
      axis.selectAll('.tick line').attr('stroke', colors.grid);
    });

  // Y axis
  g.append('g')
    .attr('class', 'y-axis')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(isMobile ? 5 : 6)
        .tickFormat((d) => formatAxisValue(d as number)),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid);
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
      axis.selectAll('.tick line').attr('stroke', colors.grid);
    });

  // Line generators
  const lineGenerator = (accessor: (d: ProjectionDataPoint) => number) =>
    d3
      .line<ProjectionDataPoint>()
      .x((d) => xScale(d.year))
      .y((d) => yScale(accessor(d)))
      .curve(d3.curveMonotoneX);

  // Sample data for performance — show every Nth point for lines
  const sampledData = sampleDataForRendering(props.data);

  // Total invested line (dashed)
  g.append('path')
    .datum(sampledData)
    .attr('fill', 'none')
    .attr('stroke', colors.totalInvested)
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '6,4')
    .attr(
      'd',
      lineGenerator((d) => d.totalInvested),
    );

  // Real (inflation-adjusted) line
  g.append('path')
    .datum(sampledData)
    .attr('fill', 'none')
    .attr('stroke', colors.real)
    .attr('stroke-width', 2.5)
    .attr(
      'd',
      lineGenerator((d) => d.real),
    );

  // Nominal line
  g.append('path')
    .datum(sampledData)
    .attr('fill', 'none')
    .attr('stroke', colors.nominal)
    .attr('stroke-width', 2.5)
    .attr(
      'd',
      lineGenerator((d) => d.nominal),
    );

  // Hover indicator dots
  const HOVER_DOT_RADIUS = 5;
  const hoverGroup = g
    .append('g')
    .attr('class', 'hover-indicators')
    .style('pointer-events', 'none')
    .style('display', 'none');

  hoverGroup
    .append('circle')
    .attr('class', 'dot-nominal')
    .attr('r', HOVER_DOT_RADIUS)
    .attr('fill', colors.nominal)
    .attr('stroke', 'white')
    .attr('stroke-width', 2);

  hoverGroup
    .append('circle')
    .attr('class', 'dot-real')
    .attr('r', HOVER_DOT_RADIUS)
    .attr('fill', colors.real)
    .attr('stroke', 'white')
    .attr('stroke-width', 2);

  hoverGroup
    .append('circle')
    .attr('class', 'dot-invested')
    .attr('r', HOVER_DOT_RADIUS)
    .attr('fill', colors.totalInvested)
    .attr('stroke', 'white')
    .attr('stroke-width', 2);

  // Shared interaction handler for both mouse and touch
  const showTooltipAt = (pointerX: number, clientCoords: { clientX: number; clientY: number }) => {
    const yearAtMouse = xScale.invert(pointerX);
    // Snap to nearest 0.5-year (6-month) interval
    const snappedMonth = Math.round(yearAtMouse * 2) * 6;

    // Find closest data point to the snapped month
    const closest = props.data.reduce(
      (prev, curr) => (Math.abs(curr.month - snappedMonth) < Math.abs(prev.month - snappedMonth) ? curr : prev),
      props.data[0]!,
    );

    tooltip.year = Math.round(closest.year * 2) / 2;
    tooltip.nominal = closest.nominal;
    tooltip.real = closest.real;
    tooltip.totalInvested = closest.totalInvested;
    tooltip.visible = true;

    updateTooltipPosition(clientCoords);

    // Position hover dots
    const cx = xScale(closest.year);
    hoverGroup.style('display', null);
    hoverGroup.select('.dot-nominal').attr('cx', cx).attr('cy', yScale(closest.nominal));
    hoverGroup.select('.dot-real').attr('cx', cx).attr('cy', yScale(closest.real));
    hoverGroup.select('.dot-invested').attr('cx', cx).attr('cy', yScale(closest.totalInvested));
  };

  const hideTooltip = () => {
    tooltip.visible = false;
    hoverGroup.style('display', 'none');
  };

  // Invisible overlay for hover/touch interaction
  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .on('mousemove', (event: MouseEvent) => {
      const [mouseX] = d3.pointer(event);
      showTooltipAt(mouseX, event);
    })
    .on('mouseleave', hideTooltip)
    .on('touchstart touchmove', (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      const [touchX] = d3.pointer(touch, svgRef.value!);
      showTooltipAt(touchX - margin.left, { clientX: touch.clientX, clientY: touch.clientY });
    })
    .on('touchend', hideTooltip);

  // Raise hover dots above overlay for visibility
  hoverGroup.raise();
};

/**
 * Sample data points to avoid rendering thousands of SVG path segments.
 * For up to 120 points (10 years), render all. Beyond that, sample evenly.
 */
const sampleDataForRendering = (data: ProjectionDataPoint[]): ProjectionDataPoint[] => {
  const MAX_POINTS = 120;
  if (data.length <= MAX_POINTS) return data;

  const step = Math.ceil(data.length / MAX_POINTS);
  const sampled: ProjectionDataPoint[] = [];
  for (let i = 0; i < data.length; i += step) {
    sampled.push(data[i]!);
  }
  // Always include the last point
  if (sampled[sampled.length - 1] !== data[data.length - 1]) {
    sampled.push(data[data.length - 1]!);
  }
  return sampled;
};

useResizeObserver(containerRef, renderChart);

watch([() => props.data, () => props.indicatorLabel, currentTheme, areAmountsHidden], renderChart, { deep: true });
</script>
