<template>
  <div class="flex flex-col">
    <h3 class="mb-4 text-lg font-semibold">
      {{ t('analytics.trends.cumulativeProgress.title') }}
      <span class="text-muted-foreground font-normal">({{ metricLabel }})</span>
    </h3>
    <div ref="containerRef" class="relative h-80 w-full">
      <svg ref="svgRef" class="h-full w-full"></svg>

      <!-- Tooltip -->
      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>{{ tooltip.monthLabel }}</ChartTooltipHeader>
          <ChartTooltipRow
            :color="metricColor"
            :label="t('analytics.trends.chart.selectedPeriod')"
            :value="formatBaseCurrency(tooltip.currentValue)"
          />
          <ChartTooltipRow :value="formatBaseCurrency(tooltip.previousValue)">
            <template #label>
              <span
                class="mr-2 inline-block size-2 shrink-0 rounded-full border-2 bg-transparent"
                :style="{ borderColor: metricColorFaded }"
              />
              {{ t('analytics.trends.chart.comparisonPeriod') }}
            </template>
          </ChartTooltipRow>
          <div class="text-card-tooltip-muted mt-1 text-xs italic">
            {{ t('analytics.trends.chart.cumulativeNote') }}
          </div>
        </ChartTooltip>
      </div>
    </div>

    <!-- Legend -->
    <div class="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
      <div class="flex items-center gap-2">
        <span class="inline-block h-0.5 w-4 rounded-full" :style="{ backgroundColor: metricColor }"></span>
        <span class="text-muted-foreground">{{ t('analytics.trends.chart.selectedPeriod') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span
          class="inline-block h-0.5 w-4 rounded-full border-2 border-dashed"
          :style="{ borderColor: metricColorFaded }"
        ></span>
        <span class="text-muted-foreground">{{ t('analytics.trends.chart.comparisonPeriod') }}</span>
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
import type { CumulativeMonthData } from '@bt/shared/types';
import * as d3 from 'd3';
import { useResizeObserver } from '@vueuse/core';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

type MetricType = 'expenses' | 'income' | 'savings';

const props = defineProps<{
  currentPeriodData: CumulativeMonthData[];
  previousPeriodData: CumulativeMonthData[];
  metric: MetricType;
}>();

const { t } = useI18n();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();

// Metric-specific colors
const METRIC_COLORS = {
  expenses: { main: 'rgb(239, 68, 68)', faded: 'rgba(239, 68, 68, 0.5)', area: 'rgba(239, 68, 68, 0.1)' },
  income: { main: 'rgb(34, 197, 94)', faded: 'rgba(34, 197, 94, 0.5)', area: 'rgba(34, 197, 94, 0.1)' },
  savings: { main: 'rgb(139, 92, 246)', faded: 'rgba(139, 92, 246, 0.5)', area: 'rgba(139, 92, 246, 0.1)' }, // violet-500
};

const metricColor = computed(() => METRIC_COLORS[props.metric].main);
const metricColorFaded = computed(() => METRIC_COLORS[props.metric].faded);

// Metric label for title
const metricLabel = computed(() => {
  const labels = {
    expenses: t('analytics.trends.metrics.expenses'),
    income: t('analytics.trends.metrics.income'),
    savings: t('analytics.trends.metrics.savings'),
  };
  return labels[props.metric];
});

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  monthLabel: '',
  currentValue: 0,
  previousValue: 0,
});

const { updateTooltipPosition } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
});

const getMargins = ({ width }: { width: number }) => {
  const isMobile = width < 400;
  return {
    top: 20,
    right: isMobile ? 10 : 20,
    left: isMobile ? 50 : 70,
    bottom: 40,
  };
};

const getColors = () => {
  const { grid, text } = getChartColors();
  const m = METRIC_COLORS[props.metric];
  return {
    grid,
    text,
    currentYear: m.main,
    previousYear: m.faded,
    areaFill: m.area,
  };
};

const renderChart = () => {
  if (!svgRef.value || !containerRef.value) return;

  const colors = getColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < 400;
  const margin = getMargins({ width });
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Get unique months from data and their labels
  const monthsInPeriod = new Map<number, string>();
  for (const d of props.currentPeriodData) {
    monthsInPeriod.set(d.month, d.monthLabel);
  }
  for (const d of props.previousPeriodData) {
    if (!monthsInPeriod.has(d.month)) {
      monthsInPeriod.set(d.month, d.monthLabel);
    }
  }

  // Sort months and get the range
  const sortedMonths = Array.from(monthsInPeriod.keys()).sort((a, b) => a - b);
  const minMonth = sortedMonths[0] || 1;
  const maxMonth = sortedMonths[sortedMonths.length - 1] || 1;
  const monthCount = maxMonth - minMonth + 1;

  // X scale - dynamic based on data
  const xScale = d3.scaleLinear().domain([minMonth, maxMonth]).range([0, innerWidth]);

  // Y scale - find max across both years
  const allValues = [...props.currentPeriodData.map((d) => d.value), ...props.previousPeriodData.map((d) => d.value)];
  const maxValue = d3.max(allValues) || 0;
  const minValue = d3.min(allValues) || 0;
  const yScale = d3
    .scaleLinear()
    .domain([Math.min(0, minValue), maxValue])
    .nice()
    .range([innerHeight, 0]);

  // Grid lines
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

  // X axis
  const fontSize = isMobile ? '10px' : '12px';
  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(sortedMonths)
        .tickFormat((d) => monthsInPeriod.get(d as number) || ''),
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

  // Zero line if we have negative values
  if (minValue < 0) {
    g.append('line')
      .attr('class', 'zero-line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', colors.grid)
      .attr('stroke-width', 1);
  }

  // Area fill for current year
  if (props.currentPeriodData.length > 0) {
    const area = d3
      .area<CumulativeMonthData>()
      .x((d) => xScale(d.month))
      .y0(yScale(0))
      .y1((d) => yScale(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(props.currentPeriodData)
      .attr('class', 'area-current')
      .attr('fill', colors.areaFill)
      .attr('d', area);
  }

  // Create line generator once for both lines
  const lineGenerator = d3
    .line<CumulativeMonthData>()
    .x((d) => xScale(d.month))
    .y((d) => yScale(d.value))
    .curve(d3.curveMonotoneX);

  // Previous year line (dashed)
  if (props.previousPeriodData.length > 0) {
    g.append('path')
      .datum(props.previousPeriodData)
      .attr('class', 'line-previous')
      .attr('fill', 'none')
      .attr('stroke', colors.previousYear)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,4')
      .attr('d', lineGenerator);
  }

  // Current year line (solid)
  if (props.currentPeriodData.length > 0) {
    g.append('path')
      .datum(props.currentPeriodData)
      .attr('class', 'line-current')
      .attr('fill', 'none')
      .attr('stroke', colors.currentYear)
      .attr('stroke-width', 2.5)
      .attr('d', lineGenerator);

    // Dots for current year
    g.selectAll('.dot-current')
      .data(props.currentPeriodData)
      .enter()
      .append('circle')
      .attr('class', 'dot-current')
      .attr('cx', (d) => xScale(d.month))
      .attr('cy', (d) => yScale(d.value))
      .attr('r', 4)
      .attr('fill', colors.currentYear)
      .style('pointer-events', 'none'); // Let hover areas handle mouse events
  }

  // Hover overlay dots for previous year (hollow circles)
  if (props.previousPeriodData.length > 0) {
    g.selectAll('.dot-previous')
      .data(props.previousPeriodData)
      .enter()
      .append('circle')
      .attr('class', 'dot-previous')
      .attr('cx', (d) => xScale(d.month))
      .attr('cy', (d) => yScale(d.value))
      .attr('r', 4)
      .attr('fill', 'var(--card)')
      .attr('stroke', colors.previousYear)
      .attr('stroke-width', 2)
      .style('pointer-events', 'none'); // Let hover areas handle mouse events
  }

  // Create invisible hover areas for each month - spanning full height
  // Combine data from both years to get all unique months
  const allMonthsData = new Map<number, { current?: CumulativeMonthData; previous?: CumulativeMonthData }>();

  for (const d of props.currentPeriodData) {
    allMonthsData.set(d.month, { current: d });
  }
  for (const d of props.previousPeriodData) {
    const existing = allMonthsData.get(d.month) || {};
    allMonthsData.set(d.month, { ...existing, previous: d });
  }

  // Calculate width for each month bar (spanning from month - 0.5 to month + 0.5)
  // Use dynamic month count for proper spacing
  const monthWidth = monthCount > 1 ? innerWidth / (monthCount - 1) : innerWidth;

  g.selectAll('.hover-area')
    .data(Array.from(allMonthsData.entries()))
    .enter()
    .append('rect')
    .attr('class', 'hover-area')
    .attr('x', ([month]) => xScale(month) - monthWidth / 2)
    .attr('y', 0)
    .attr('width', monthWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('mouseenter', (event: MouseEvent, [month, data]) => {
      const currentData = data.current;
      const previousData = data.previous;
      const monthLabel = currentData?.monthLabel || previousData?.monthLabel || monthsInPeriod.get(month) || '';

      tooltip.monthLabel = monthLabel;
      tooltip.currentValue = currentData?.value || 0;
      tooltip.previousValue = previousData?.value || 0;
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('mousemove', handleMouseMove)
    .on('mouseleave', handleMouseLeave);
};

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: getCurrencySymbol() });

function handleMouseMove(event: MouseEvent) {
  updateTooltipPosition(event);
}

function handleMouseLeave() {
  tooltip.visible = false;
}

useResizeObserver(containerRef, renderChart);

watch([() => props.currentPeriodData, () => props.previousPeriodData, () => props.metric, currentTheme], renderChart, {
  deep: true,
});
</script>
