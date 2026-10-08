<template>
  <div v-if="data.length === 0" class="text-muted-foreground py-16 text-center text-sm">
    {{ $t('pages.budgetDetails.statistics.noTimelineData') }}
  </div>

  <template v-else>
    <div class="flex flex-col">
      <div ref="containerRef" class="relative h-72 w-full">
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
              v-if="tooltip.income > 0"
              color="var(--success-text)"
              :label="$t('pages.budgetDetails.statistics.incomeLabel')"
              :value="formatBaseCurrency(tooltip.income)"
            />
            <ChartTooltipRow
              color="var(--destructive-text)"
              :label="$t('pages.budgetDetails.statistics.expensesLabel')"
              :value="formatBaseCurrency(tooltip.expense)"
            />
          </ChartTooltip>
        </div>
      </div>

      <!-- Legend -->
      <div class="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
        <div v-if="hasIncome" class="flex items-center gap-2">
          <span class="bg-success-text inline-block size-3 rounded-sm"></span>
          <span class="text-muted-foreground">{{ $t('pages.budgetDetails.statistics.income') }}</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="bg-destructive-text inline-block size-3 rounded-sm"></span>
          <span class="text-muted-foreground">{{ $t('pages.budgetDetails.statistics.expenses') }}</span>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useDateLocale } from '@/composable/use-date-locale';
import type { BudgetSpendingPeriod } from '@bt/shared/types';
import * as d3 from 'd3';
import { parseISO } from 'date-fns';
import { useResizeObserver } from '@vueuse/core';
import { computed, reactive, ref, watch } from 'vue';

const props = defineProps<{
  data: BudgetSpendingPeriod[];
  granularity: 'monthly' | 'weekly';
}>();

const { format } = useDateLocale();
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
  expense: 0,
});

const { updateTooltipPosition } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
});

const hasIncome = computed(() => props.data.some((d) => d.income > 0));

const getColors = () => {
  const { grid, text, successText, destructiveText } = getChartColors();
  return {
    grid,
    text,
    income: successText,
    expenses: destructiveText,
  };
};

const formatPeriodLabel = (periodStart: string): string => {
  const date = parseISO(periodStart);
  return props.granularity === 'monthly' ? format(date, 'MMM yy') : format(date, 'MMM d');
};

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: getCurrencySymbol() });

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || props.data.length === 0) return;

  const colors = getColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < 400;

  const spacePerLabel = width / props.data.length;
  const shouldRotateLabels = spacePerLabel < 55 || props.data.length >= 12;

  const margin = {
    top: 20,
    right: isMobile ? 10 : 20,
    left: isMobile ? 40 : 60,
    bottom: shouldRotateLabels ? 70 : 40,
  };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3
    .scaleBand()
    .domain(props.data.map((d) => d.periodStart))
    .range([0, innerWidth])
    .padding(0.2);

  const maxExpense = d3.max(props.data, (d) => d.expense) || 0;
  const maxIncome = d3.max(props.data, (d) => d.income) || 0;
  const maxValue = Math.max(maxExpense, maxIncome);

  const yScale = d3.scaleLinear().domain([0, maxValue]).nice().range([innerHeight, 0]);

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

  const MAX_BAR_WIDTH = 60;
  const bandwidth = xScale.bandwidth();
  const showIncome = hasIncome.value;

  if (showIncome) {
    // Grouped bars: income + expense side by side
    const halfBarWidth = Math.min(bandwidth / 2 - 2, MAX_BAR_WIDTH / 2);
    const barOffset = (bandwidth - halfBarWidth * 2 - 4) / 2;

    // Income bars (left)
    g.selectAll('.bar-income')
      .data(props.data)
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
      .on('mouseenter', handleMouseEnter)
      .on('mousemove', handleMouseMove)
      .on('mouseleave', handleMouseLeave);

    // Expense bars (right)
    g.selectAll('.bar-expenses')
      .data(props.data)
      .enter()
      .append('rect')
      .attr('class', 'bar-expenses')
      .attr('x', (d) => xScale(d.periodStart)! + barOffset + halfBarWidth + 4)
      .attr('y', (d) => yScale(d.expense))
      .attr('width', halfBarWidth)
      .attr('height', (d) => innerHeight - yScale(d.expense))
      .attr('fill', colors.expenses)
      .attr('rx', 4)
      .attr('ry', 4)
      .on('mouseenter', handleMouseEnter)
      .on('mousemove', handleMouseMove)
      .on('mouseleave', handleMouseLeave);
  } else {
    // Single expense bars
    const barWidth = Math.min(bandwidth, MAX_BAR_WIDTH);
    const barOffset = (bandwidth - barWidth) / 2;

    g.selectAll('.bar-expenses')
      .data(props.data)
      .enter()
      .append('rect')
      .attr('class', 'bar-expenses')
      .attr('x', (d) => xScale(d.periodStart)! + barOffset)
      .attr('y', (d) => yScale(d.expense))
      .attr('width', barWidth)
      .attr('height', (d) => innerHeight - yScale(d.expense))
      .attr('fill', colors.expenses)
      .attr('rx', 4)
      .attr('ry', 4)
      .on('mouseenter', handleMouseEnter)
      .on('mousemove', handleMouseMove)
      .on('mouseleave', handleMouseLeave);
  }
};

function handleMouseEnter(event: MouseEvent, d: BudgetSpendingPeriod) {
  const startDate = parseISO(d.periodStart);
  const endDate = parseISO(d.periodEnd);
  const isSameMonth = startDate.getMonth() === endDate.getMonth() && startDate.getFullYear() === endDate.getFullYear();

  tooltip.period = isSameMonth
    ? format(startDate, 'MMMM yyyy')
    : `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
  tooltip.income = d.income;
  tooltip.expense = d.expense;
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

watch([() => props.data, () => props.granularity, currentTheme], renderChart, { deep: true });
</script>
