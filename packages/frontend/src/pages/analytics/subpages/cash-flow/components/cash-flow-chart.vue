<template>
  <div class="flex flex-col">
    <div ref="containerRef" class="relative h-100 w-full">
      <svg ref="svgRef" class="h-full w-full"></svg>

      <!-- Tooltip -->
      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>{{ tooltip.period }}</ChartTooltipHeader>
          <ChartTooltipRow
            color="var(--app-income-color)"
            :label="t('analytics.cashFlow.income')"
            :value="formatBaseCurrency(tooltip.income)"
          />
          <ChartTooltipRow
            color="var(--app-expense-color)"
            :label="t('analytics.cashFlow.expenses')"
            :value="formatBaseCurrency(tooltip.expenses)"
          />
          <ChartTooltipDivider />
          <ChartTooltipRow
            total
            :label="t('analytics.cashFlow.netFlow')"
            :value="formatBaseCurrency(tooltip.netFlow)"
            :value-class="tooltip.netFlow >= 0 ? 'text-app-income-color' : 'text-app-expense-color'"
          />
        </ChartTooltip>
      </div>
    </div>

    <!-- Legend -->
    <div class="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
      <div class="flex items-center gap-2">
        <span class="bg-app-income-color inline-block size-3 rounded-sm"></span>
        <span class="text-muted-foreground">{{ t('analytics.cashFlow.income') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="bg-app-expense-color inline-block size-3 rounded-sm"></span>
        <span class="text-muted-foreground">{{ t('analytics.cashFlow.expenses') }}</span>
      </div>
      <div v-if="showMovingAverage" class="flex items-center gap-2">
        <span class="inline-block h-0.5 w-4 rounded-full bg-blue-500"></span>
        <span class="text-muted-foreground">{{ t('analytics.cashFlow.trendLine') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import {
  ChartTooltip,
  ChartTooltipDivider,
  ChartTooltipHeader,
  ChartTooltipRow,
} from '@/components/common/charts/chart-tooltip';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useDateLocale } from '@/composable/use-date-locale';
import type { Period } from '@/composable/use-period-navigation';
import type { CashFlowPeriodData } from '@bt/shared/types';
import * as d3 from 'd3';
import { format as formatISODate, parseISO } from 'date-fns';
import { useResizeObserver } from '@vueuse/core';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { ChartType } from './chart-type-switcher.vue';

const props = defineProps<{
  data: CashFlowPeriodData[];
  chartType: ChartType;
  showMovingAverage?: boolean;
  highlightedPeriod?: Period;
}>();

const emit = defineEmits<{
  selectPeriod: [value: Period];
}>();

const highlightedKey = computed(() => {
  const period = props.highlightedPeriod;
  return period ? `${formatISODate(period.from, 'yyyy-MM-dd')}|${formatISODate(period.to, 'yyyy-MM-dd')}` : null;
});

function handleClick(_event: MouseEvent, d: (typeof chartData.value)[0]) {
  emit('selectPeriod', { from: parseISO(d.periodStart), to: parseISO(d.periodEnd) });
}

const bindBarInteractions = <T extends d3.BaseType>(
  selection: d3.Selection<T, (typeof chartData.value)[0], d3.BaseType, unknown>,
  colors: { text: string },
) =>
  selection
    .on('mouseenter', handleMouseEnter)
    .on('mousemove', handleMouseMove)
    .on('mouseleave', handleMouseLeave)
    .on('click', handleClick)
    .attr('cursor', 'pointer')
    .attr('stroke', (d) => (`${d.periodStart}|${d.periodEnd}` === highlightedKey.value ? colors.text : 'none'))
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '3 2');

const { t } = useI18n();
const { format, locale } = useDateLocale();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  period: '',
  income: 0,
  expenses: 0,
  netFlow: 0,
});

const { updateTooltipPosition } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
});

// Responsive margins based on container width
const getMargins = ({ width, shouldRotate }: { width: number; shouldRotate: boolean }) => {
  const isMobile = width < 400;
  return {
    top: 20,
    right: isMobile ? 10 : 20,
    left: isMobile ? 40 : 60,
    bottom: shouldRotate ? 70 : 40,
  };
};

const getColors = () => {
  const { grid, text, appIncome, appExpense } = getChartColors();
  return {
    grid,
    text,
    income: appIncome,
    expenses: appExpense,
    movingAverage: 'rgb(59, 130, 246)', // blue-500
  };
};

// Calculate 3-period moving average for net flow
// Uses partial averages at the start (1, 2, then 3 periods) so line starts from first bar
const calculateMovingAverage = (data: typeof chartData.value, periods: number = 3) => {
  return data.map((_, index) => {
    const availablePeriods = Math.min(index + 1, periods);
    let sum = 0;
    for (let i = 0; i < availablePeriods; i++) {
      sum += data[index - i]!.netFlow;
    }
    return sum / availablePeriods;
  });
};

const formatPeriodLabel = (periodStart: string): string => {
  const date = parseISO(periodStart);
  return format(date, 'MMM yy');
};

const chartData = computed(() => {
  return props.data.map((d) => ({
    periodStart: d.periodStart,
    periodEnd: d.periodEnd,
    income: d.income,
    // All three bar layouts size the expense bar from a magnitude growing away from a baseline. A
    // period whose refunds outweigh its purchases reports negative expenses; it draws as no bar,
    // while the tooltip keeps the real figure.
    expenses: Math.max(d.expenses, 0),
    expensesValue: d.expenses,
    netFlow: d.netFlow,
  }));
});

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || chartData.value.length === 0) return;

  const colors = getColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < 400;

  // Determine if labels should rotate based on available space per label
  // Each label needs ~50px when horizontal, less when rotated
  const spacePerLabel = width / chartData.value.length;
  const shouldRotateLabels = spacePerLabel < 55 || chartData.value.length >= 12;

  const margin = getMargins({ width, shouldRotate: shouldRotateLabels });
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // X scale (bands for each period)
  const xScale = d3
    .scaleBand()
    .domain(chartData.value.map((d) => d.periodStart))
    .range([0, innerWidth])
    .padding(0.2);

  // Calculate moving average if enabled
  const movingAverageData = props.showMovingAverage ? calculateMovingAverage(chartData.value) : [];
  const validMAValues = movingAverageData.filter((v): v is number => v !== null);

  // Y scale depends on chart type
  let yScale: d3.ScaleLinear<number, number>;
  const maxIncome = d3.max(chartData.value, (d) => d.income) || 0;
  const maxExpenses = d3.max(chartData.value, (d) => d.expenses) || 0;

  if (props.chartType === 'stacked') {
    const maxStacked = d3.max(chartData.value, (d) => d.income + d.expenses) || 0;
    const maxMA = validMAValues.length > 0 ? Math.max(...validMAValues) : 0;
    const minMA = validMAValues.length > 0 ? Math.min(...validMAValues) : 0;
    const domainMax = Math.max(maxStacked, maxMA);
    const domainMin = Math.min(0, minMA);
    yScale = d3.scaleLinear().domain([domainMin, domainMax]).nice().range([innerHeight, 0]);
  } else if (props.chartType === 'mirrored') {
    // Include moving average in the domain for mirrored chart
    const maxMA = validMAValues.length > 0 ? Math.max(...validMAValues) : 0;
    const minMA = validMAValues.length > 0 ? Math.min(...validMAValues) : 0;
    const domainMax = Math.max(maxIncome, maxMA);
    const domainMin = Math.min(-maxExpenses, minMA);
    yScale = d3.scaleLinear().domain([domainMin, domainMax]).nice().range([innerHeight, 0]);
  } else {
    // grouped - include moving average (which can be negative when expenses > income)
    const maxMA = validMAValues.length > 0 ? Math.max(...validMAValues) : 0;
    const minMA = validMAValues.length > 0 ? Math.min(...validMAValues) : 0;
    const maxValue = Math.max(maxIncome, maxExpenses, maxMA);
    const minValue = Math.min(0, minMA);
    yScale = d3.scaleLinear().domain([minValue, maxValue]).nice().range([innerHeight, 0]);
  }

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

  // X axis - always at the bottom for readability
  // Rotate labels based on available space (calculated above)
  const labelRotation = shouldRotateLabels ? -45 : 0;
  const fontSize = isMobile ? '10px' : '12px';

  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).tickFormat((d) => formatPeriodLabel(d as string)))
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid);
      axis
        .selectAll('.tick text')
        .attr('fill', colors.text)
        .attr('font-size', fontSize)
        .attr('transform', `rotate(${labelRotation})`)
        .attr('text-anchor', shouldRotateLabels ? 'end' : 'middle')
        .attr('dx', shouldRotateLabels ? '-0.5em' : '0')
        .attr('dy', shouldRotateLabels ? '0.5em' : '0.7em');
      axis.selectAll('.tick line').attr('stroke', colors.grid);
    });

  // Center line for mirrored chart (the zero axis)
  if (props.chartType === 'mirrored') {
    g.append('line')
      .attr('class', 'zero-line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', colors.grid)
      .attr('stroke-width', 1);
  }

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

  // Render bars based on chart type
  const MAX_BAR_WIDTH = 60;
  const bandwidth = xScale.bandwidth();
  const barWidth = Math.min(bandwidth, MAX_BAR_WIDTH);
  const barOffset = (bandwidth - barWidth) / 2; // Center bars when narrower than bandwidth
  const halfBarWidth = barWidth / 2 - 2;

  if (props.chartType === 'stacked') {
    renderStackedBars(g, xScale, yScale, colors, innerHeight, barWidth, barOffset);
  } else if (props.chartType === 'mirrored') {
    renderMirroredBars(g, xScale, yScale, colors, barWidth, barOffset);
  } else {
    renderGroupedBars(g, xScale, yScale, colors, halfBarWidth, innerHeight, barOffset);
  }

  // Render moving average line
  if (props.showMovingAverage && movingAverageData.length > 0) {
    const lineData = chartData.value
      .map((d, i) => ({
        periodStart: d.periodStart,
        value: movingAverageData[i],
      }))
      .filter((d): d is { periodStart: string; value: number } => d.value !== null);

    const line = d3
      .line<{ periodStart: string; value: number }>()
      .x((d) => xScale(d.periodStart)! + bandwidth / 2)
      .y((d) => yScale(d.value))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(lineData)
      .attr('class', 'moving-average-line')
      .attr('fill', 'none')
      .attr('stroke', colors.movingAverage)
      .attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round')
      .attr('d', line);

    // Add dots at each data point
    g.selectAll('.ma-dot')
      .data(lineData)
      .enter()
      .append('circle')
      .attr('class', 'ma-dot')
      .attr('cx', (d) => xScale(d.periodStart)! + bandwidth / 2)
      .attr('cy', (d) => yScale(d.value))
      .attr('r', 4)
      .attr('fill', colors.movingAverage);
  }
};

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: getCurrencySymbol() });

const renderStackedBars = (
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleBand<string>,
  yScale: d3.ScaleLinear<number, number>,
  colors: ReturnType<typeof getColors>,
  innerHeight: number,
  barWidth: number,
  barOffset: number,
) => {
  // Expenses bars (bottom) - baseline spending
  g.selectAll('.bar-expenses')
    .data(chartData.value)
    .enter()
    .append('rect')
    .attr('class', 'bar-expenses')
    .attr('x', (d) => xScale(d.periodStart)! + barOffset)
    .attr('y', (d) => yScale(d.expenses))
    .attr('width', barWidth)
    .attr('height', (d) => innerHeight - yScale(d.expenses))
    .attr('fill', colors.expenses)
    .attr('rx', 4)
    .attr('ry', 4)
    .call(bindBarInteractions, colors);

  // Income bars (on top)
  g.selectAll('.bar-income')
    .data(chartData.value)
    .enter()
    .append('rect')
    .attr('class', 'bar-income')
    .attr('x', (d) => xScale(d.periodStart)! + barOffset)
    .attr('y', (d) => yScale(d.expenses + d.income))
    .attr('width', barWidth)
    .attr('height', (d) => yScale(d.expenses) - yScale(d.expenses + d.income))
    .attr('fill', colors.income)
    .attr('rx', 4)
    .attr('ry', 4)
    .call(bindBarInteractions, colors);
};

const renderMirroredBars = (
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleBand<string>,
  yScale: d3.ScaleLinear<number, number>,
  colors: ReturnType<typeof getColors>,
  barWidth: number,
  barOffset: number,
) => {
  const centerY = yScale(0);

  // Income bars (go UP from center)
  g.selectAll('.bar-income')
    .data(chartData.value)
    .enter()
    .append('rect')
    .attr('class', 'bar-income')
    .attr('x', (d) => xScale(d.periodStart)! + barOffset)
    .attr('y', (d) => yScale(d.income))
    .attr('width', barWidth)
    .attr('height', (d) => centerY - yScale(d.income))
    .attr('fill', colors.income)
    .attr('rx', 4)
    .attr('ry', 4)
    .call(bindBarInteractions, colors);

  // Expenses bars (go DOWN from center)
  g.selectAll('.bar-expenses')
    .data(chartData.value)
    .enter()
    .append('rect')
    .attr('class', 'bar-expenses')
    .attr('x', (d) => xScale(d.periodStart)! + barOffset)
    .attr('y', centerY)
    .attr('width', barWidth)
    .attr('height', (d) => yScale(-d.expenses) - centerY)
    .attr('fill', colors.expenses)
    .attr('rx', 4)
    .attr('ry', 4)
    .call(bindBarInteractions, colors);
};

const renderGroupedBars = (
  g: d3.Selection<SVGGElement, unknown, null, undefined>,
  xScale: d3.ScaleBand<string>,
  yScale: d3.ScaleLinear<number, number>,
  colors: ReturnType<typeof getColors>,
  halfBarWidth: number,
  innerHeight: number,
  barOffset: number,
) => {
  // Income bars (left side)
  g.selectAll('.bar-income')
    .data(chartData.value)
    .enter()
    .append('rect')
    .attr('class', 'bar-income')
    .attr('x', (d) => xScale(d.periodStart)! + barOffset)
    .attr('y', (d) => yScale(d.income))
    .attr('width', halfBarWidth)
    .attr('height', (d) => innerHeight - yScale(d.income))
    .attr('fill', colors.income)
    .attr('rx', 4)
    .attr('ry', 4)
    .call(bindBarInteractions, colors);

  // Expenses bars (right side)
  g.selectAll('.bar-expenses')
    .data(chartData.value)
    .enter()
    .append('rect')
    .attr('class', 'bar-expenses')
    .attr('x', (d) => xScale(d.periodStart)! + barOffset + halfBarWidth + 4)
    .attr('y', (d) => yScale(d.expenses))
    .attr('width', halfBarWidth)
    .attr('height', (d) => innerHeight - yScale(d.expenses))
    .attr('fill', colors.expenses)
    .attr('rx', 4)
    .attr('ry', 4)
    .call(bindBarInteractions, colors);
};

function handleMouseEnter(event: MouseEvent, d: (typeof chartData.value)[0]) {
  const startDate = parseISO(d.periodStart);
  const endDate = parseISO(d.periodEnd);
  const isSameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();

  tooltip.period = isSameMonth
    ? format(startDate, 'MMMM yyyy')
    : `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
  tooltip.income = d.income;
  tooltip.expenses = d.expensesValue;
  tooltip.netFlow = d.netFlow;
  tooltip.visible = true;

  updateTooltipPosition(event);
}

function handleMouseMove(event: MouseEvent) {
  updateTooltipPosition(event);
}

function handleMouseLeave() {
  tooltip.visible = false;
}

useResizeObserver(containerRef, renderChart);

watch(
  [
    () => props.data,
    () => props.chartType,
    () => props.showMovingAverage,
    () => props.highlightedPeriod,
    locale,
    currentTheme,
  ],
  renderChart,
  { deep: true },
);
</script>
