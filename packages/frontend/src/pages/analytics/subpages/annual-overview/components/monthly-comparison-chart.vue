<template>
  <div class="border-border bg-card rounded-lg border p-4">
    <div class="flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2">
      <h3 class="text-lg font-semibold">
        {{ t('analytics.trends.monthlyComparison.title') }}
        <span class="text-muted-foreground font-normal">({{ metricLabel }})</span>
      </h3>
    </div>

    <!-- Loading skeleton -->
    <ChartSkeleton v-if="isLoading" />

    <!-- Error state -->
    <div v-else-if="isError" class="flex h-80 items-center justify-center">
      <div class="text-destructive-text">{{ t('analytics.trends.loadError') }}</div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!chartData.length" class="flex h-80 items-center justify-center">
      <div class="text-center">
        <div class="text-muted-foreground">{{ t('analytics.trends.noData') }}</div>
        <div class="text-muted-foreground mt-1 text-sm">{{ t('analytics.trends.noDataHint') }}</div>
      </div>
    </div>

    <!-- Chart -->
    <template v-else>
      <div class="flex flex-col">
        <div ref="containerRef" class="relative h-80 w-full">
          <svg ref="svgRef" :class="['h-full w-full', { 'pointer-events-none': isTooltipInteracting }]"></svg>

          <!-- Tooltip -->
          <div
            v-show="tooltip.visible"
            ref="tooltipRef"
            :class="[
              'absolute',
              !isTouchDevice || tooltip.isAverage ? 'pointer-events-none z-10' : 'pointer-events-auto z-50',
            ]"
            :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
            @mouseenter="isTooltipInteracting = true"
            @mouseleave="handleTooltipMouseLeave"
            @touchstart.stop="isTooltipInteracting = true"
          >
            <ChartTooltip>
              <!-- Average line tooltip -->
              <template v-if="tooltip.isAverage">
                <ChartTooltipRow
                  :color="AVERAGE_LINE_COLOR"
                  :label="t('analytics.trends.monthlyComparison.average')"
                  :value="formatBaseCurrency(tooltip.value)"
                />
              </template>
              <!-- Bar tooltips -->
              <template v-else>
                <ChartTooltipHeader>{{ tooltip.period }}</ChartTooltipHeader>
                <!-- Category-specific tooltip with total -->
                <template v-if="tooltip.categoryName">
                  <ChartTooltipRow
                    :color="tooltip.categoryColor"
                    :label="tooltip.categoryName"
                    :value="formatBaseCurrency(tooltip.value)"
                  />
                  <ChartTooltipRow
                    v-if="tooltip.totalValue !== undefined"
                    :label="t('analytics.trends.monthlyComparison.total')"
                    :value="formatBaseCurrency(tooltip.totalValue)"
                  />
                </template>
                <!-- Total tooltip (non-stacked bars) -->
                <ChartTooltipRow v-else :label="metricLabel" :value="formatBaseCurrency(tooltip.value)" />

                <template v-if="tooltip.momChange !== undefined">
                  <ChartTooltipDivider />
                  <ChartTooltipRow
                    :label="t('analytics.trends.monthlyComparison.vsLastMonth')"
                    :value="`${tooltip.momChange > 0 ? '+' : ''}${tooltip.momChange}%`"
                    :value-class="getChangeColorClass(tooltip.momChange)"
                  />
                </template>
                <!-- View transactions link (shown on touch devices) -->
                <button
                  v-if="isTouchDevice && tooltip.periodStart && tooltip.periodEnd"
                  type="button"
                  class="text-primary-text mt-2 block w-full text-left text-sm font-medium underline"
                  @touchstart.stop
                  @touchend.stop="handleViewTransactionsClick"
                  @click.stop.prevent="handleViewTransactionsClick"
                >
                  {{ t('analytics.trends.monthlyComparison.viewTransactions') }} →
                </button>
              </template>
            </ChartTooltip>
          </div>
        </div>

        <!-- Legend -->
        <div class="mt-3 flex flex-wrap items-center justify-center gap-x-1 gap-y-1 text-xs">
          <template v-if="hasStackedBars">
            <DesktopOnlyTooltip
              v-for="cat in chartCategories"
              :key="cat.categoryId"
              :content="$t('analytics.trends.legend.hide')"
            >
              <Button
                variant="ghost"
                size="sm"
                class="h-7 gap-1.5 px-2 text-xs"
                @click="emit('hide-category', { categoryId: cat.categoryId })"
              >
                <span class="inline-block size-2.5 shrink-0 rounded-sm" :style="{ backgroundColor: cat.color }"></span>
                <span class="text-muted-foreground">{{ cat.name }}</span>
              </Button>
            </DesktopOnlyTooltip>
          </template>
          <template v-else>
            <div class="flex items-center gap-1.5 px-2">
              <span class="inline-block size-2.5 rounded-sm" :style="{ backgroundColor: singleBarColor }"></span>
              <span class="text-muted-foreground">{{ metricLabel }}</span>
            </div>
          </template>

          <template v-if="props.metric !== 'savings'">
            <DesktopOnlyTooltip
              v-for="cat in hiddenCategories"
              :key="`hidden-${cat.id}`"
              :content="$t('analytics.trends.legend.show')"
            >
              <Button
                variant="ghost"
                size="sm"
                class="h-7 gap-1.5 px-2 text-xs"
                @click="emit('show-category', { categoryId: cat.id })"
              >
                <EyeOffIcon class="text-muted-foreground size-3 shrink-0" />
                <span class="text-muted-foreground line-through">{{ cat.name }}</span>
              </Button>
            </DesktopOnlyTooltip>
          </template>

          <div v-if="showAverageLine" class="flex items-center gap-1.5 px-2">
            <span
              class="inline-block h-0.5 w-3"
              :style="{ background: AVERAGE_LINE_COLOR, borderStyle: 'dashed' }"
            ></span>
            <span class="text-muted-foreground">{{ t('analytics.trends.monthlyComparison.average') }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { getCashFlow } from '@/api';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { currentTheme } from '@/common/utils/color-theme';
import {
  ChartTooltip,
  ChartTooltipDivider,
  ChartTooltipHeader,
  ChartTooltipRow,
} from '@/components/common/charts/chart-tooltip';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { AVERAGE_LINE_COLOR, renderAverageLine } from '@/composable/charts/render-average-line';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useDateLocale } from '@/composable/use-date-locale';
import { ROUTES_NAMES } from '@/routes';
import { useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES, type CashFlowCategoryData, type CashFlowPeriodData } from '@bt/shared/types';
import { EyeOffIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { endOfMonth, parseISO, startOfMonth } from 'date-fns';
import { storeToRefs } from 'pinia';
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { type TrendsFilters, toStatsFilterParams } from '../trends-filters';
import ChartSkeleton from '../../cash-flow/components/chart-skeleton.vue';

interface PeriodWithChange {
  periodStart: string;
  periodEnd: string;
  value: number;
  momChange?: number;
  categories?: CashFlowCategoryData[];
}

const props = defineProps<{
  from: Date;
  to: Date;
  metric: 'expenses' | 'income' | 'savings';
  filters: TrendsFilters;
}>();

const emit = defineEmits<{
  'hide-category': [payload: { categoryId: string }];
  'show-category': [payload: { categoryId: string }];
}>();

const { t } = useI18n();
const { format, locale } = useDateLocale();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();
const router = useRouter();

const { categories } = storeToRefs(useCategoriesStore());

// Detect touch device by touch capabilities
const isTouchDevice = ref(false);
onMounted(() => {
  isTouchDevice.value = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
});

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  period: '',
  value: 0,
  totalValue: undefined as number | undefined,
  momChange: undefined as number | undefined,
  categoryName: undefined as string | undefined,
  categoryColor: undefined as string | undefined,
  categoryId: undefined as string | undefined,
  isAverage: false,
  // Navigation data
  periodStart: undefined as string | undefined,
  periodEnd: undefined as string | undefined,
});

// Flag to prevent chart interactions while tooltip link is being clicked
const isTooltipInteracting = ref(false);

const { updateTooltipPosition } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
});

// Query params — snap to whole months so partial first/last months don't
// produce truncated bars (e.g. "May 30 2025 – May 30 2026" should still show
// the full May 2025 bin, not just May 30–31).
const queryParams = computed(() => ({
  from: startOfMonth(props.from),
  to: endOfMonth(props.to),
  granularity: 'monthly' as const,
  ...toStatsFilterParams({ filters: props.filters }),
}));

// Fetch cash flow data
const {
  data: cashFlowData,
  isLoading,
  isError,
} = useQuery({
  queryKey: [...VUE_QUERY_CACHE_KEYS.analyticsCashFlow, 'monthly-comparison', queryParams],
  queryFn: () => getCashFlow(queryParams.value),
  staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
  gcTime: QUERY_CACHE_STALE_TIME.ANALYTICS * 2,
});

// Check if we have stacked bars (multiple categories with data for current metric)
// Savings mode never uses stacked bars — it shows net flow as simple bars
const hasStackedBars = computed(() => {
  return props.metric !== 'savings' && chartCategories.value.length > 1;
});

// Categories from API response for legend, filtered by metric
const chartCategories = computed(() => {
  if (!chartData.value.length) return [];
  const allCategories = chartData.value[0]!.categories || [];

  // Filter to only show categories that have non-zero amount for the current metric
  // across all periods
  return allCategories.filter((cat) => {
    // Check if this category has any amount for the current metric in any period
    for (const period of chartData.value) {
      const periodCat = period.categories?.find((c) => c.categoryId === cat.categoryId);
      if (periodCat && getCategoryAmount(periodCat) !== 0) {
        return true;
      }
    }
    return false;
  });
});

const hiddenCategories = computed(() => {
  if (props.filters.categories.mode !== 'exclude') return [];
  return props.filters.categories.ids
    .map((id) => categories.value.find((cat) => cat.id === id))
    .filter((cat): cat is NonNullable<typeof cat> => Boolean(cat));
});

// Metric label
const metricLabel = computed(() => {
  const labels = {
    expenses: t('analytics.trends.metrics.expenses'),
    income: t('analytics.trends.metrics.income'),
    savings: t('analytics.trends.metrics.savings'),
  };
  return labels[props.metric];
});

// Get value based on metric
// The endpoint already returns expenses as a positive magnitude, except where a refund landed in a
// bucket its original purchase isn't in — there the bucket is genuinely negative and must stay so.
const getMetricValue = (period: CashFlowPeriodData): number => {
  switch (props.metric) {
    case 'expenses':
      return period.expenses;
    case 'income':
      return period.income;
    case 'savings':
      return period.netFlow;
    default:
      return 0;
  }
};

// Get category amount based on current metric
const getCategoryAmount = (cat: CashFlowCategoryData): number => {
  switch (props.metric) {
    case 'expenses':
      return cat.expenseAmount;
    case 'income':
      return cat.incomeAmount;
    case 'savings':
      // For savings, we might use netFlow (income - expense) but categories don't have this
      return cat.incomeAmount - cat.expenseAmount;
    default:
      return 0;
  }
};

// Sum of only the positive (or only the negative) amounts — the bounds a stack's running total
// can reach whatever order its segments are drawn in.
const sumBySign = ({ amounts, keepPositive }: { amounts: number[]; keepPositive: boolean }): number =>
  amounts.reduce((acc, amount) => acc + (keepPositive ? Math.max(amount, 0) : Math.min(amount, 0)), 0);

// Get the displayed value for a period (what the bar actually shows)
// For stacked bars, this is the sum of category amounts; otherwise the metric total
const getDisplayedValue = (period: CashFlowPeriodData): number => {
  // Savings always uses the period-level netFlow (not category breakdown)
  if (props.metric === 'savings') {
    return getMetricValue(period);
  }
  // If we have categories and they're being displayed as stacked bars,
  // use the sum of category amounts to match what's visually shown
  if (period.categories && period.categories.length > 0) {
    return period.categories.reduce((sum, cat) => sum + getCategoryAmount(cat), 0);
  }
  // Otherwise use the period total
  return getMetricValue(period);
};

// Chart data with MoM changes
const chartData = computed<PeriodWithChange[]>(() => {
  if (!cashFlowData.value?.periods) return [];

  return cashFlowData.value.periods.map((period, index) => {
    // Use displayed value (sum of categories if available) for consistency with visual bars
    const currentValue = getDisplayedValue(period);
    let momChange: number | undefined;

    if (index > 0) {
      const prevPeriod = cashFlowData.value!.periods[index - 1]!;
      const prevValue = getDisplayedValue(prevPeriod);

      if (prevValue === 0) {
        momChange = currentValue > 0 ? 100 : 0;
      } else {
        momChange = Math.round(((currentValue - prevValue) / Math.abs(prevValue)) * 100);
      }
    }

    return {
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      value: currentValue,
      momChange,
      categories: period.categories,
    };
  });
});

// Show average line when 3+ months of data
const showAverageLine = computed(() => {
  return chartData.value.length >= 3;
});

const averageValue = computed(() => {
  if (!showAverageLine.value) return null;
  const values = chartData.value.map((d) => d.value);
  return values.reduce((a, b) => a + b, 0) / values.length;
});

// Single bar color based on metric (used when only one category or no stacked bars)
const singleBarColor = computed(() => {
  // If we have exactly one category, use its color
  if (chartCategories.value.length === 1) {
    return chartCategories.value[0]!.color;
  }

  // Otherwise use metric-based color
  const root = document.documentElement;
  const style = getComputedStyle(root);

  switch (props.metric) {
    case 'expenses':
      return style.getPropertyValue('--destructive-text').trim() || 'rgb(239, 68, 68)';
    case 'income':
      return style.getPropertyValue('--success-text').trim() || 'rgb(46, 204, 113)';
    case 'savings':
      return 'rgb(59, 130, 246)'; // blue-500
    default:
      return 'rgb(161, 161, 170)';
  }
});

// Get change color class
const getChangeColorClass = (change: number): string => {
  if (change === 0) return 'text-card-tooltip-muted';

  // For expenses, decrease is good (green), increase is bad (red)
  // For income/savings, increase is good (green), decrease is bad (red)
  const isPositiveGood = props.metric !== 'expenses';

  if (change > 0) {
    return isPositiveGood ? 'text-green-500' : 'text-red-500';
  } else {
    return isPositiveGood ? 'text-red-500' : 'text-green-500';
  }
};

const getColors = () => {
  const { grid, text, card } = getChartColors();
  return {
    grid,
    text,
    bar: singleBarColor.value,
    averageLabelBg: card,
    positive: 'rgb(34, 197, 94)', // green-500
    negative: 'rgb(239, 68, 68)', // red-500
  };
};

const getMargins = ({ width, shouldRotate }: { width: number; shouldRotate: boolean }) => {
  const isMobile = width < 400;
  return {
    top: 40, // Space for MoM badges
    right: isMobile ? 10 : 20,
    left: isMobile ? 40 : 60,
    bottom: shouldRotate ? 70 : 40,
  };
};

const formatPeriodLabel = (periodStart: string): string => {
  const date = parseISO(periodStart);
  return format(date, 'MMM yy');
};

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: getCurrencySymbol() });

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || chartData.value.length === 0) return;

  const colors = getColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  // Add defs element for gradients and filters
  svg.append('defs');

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < 400;

  const spacePerLabel = width / chartData.value.length;
  const shouldRotateLabels = spacePerLabel < 55 || chartData.value.length >= 12;

  const margin = getMargins({ width, shouldRotate: shouldRotateLabels });
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // X scale
  const xScale = d3
    .scaleBand()
    .domain(chartData.value.map((d) => d.periodStart))
    .range([0, innerWidth])
    .padding(0.3);

  // Determine if we're rendering stacked bars
  const isStacked = hasStackedBars.value && chartData.value.some((d) => d.categories && d.categories.length > 0);

  // Get list of category IDs to render (only those with data for current metric)
  const renderCategoryIds = new Set(chartCategories.value.map((c) => c.categoryId));

  // Y scale — the domain has to cover negatives for every metric, not just savings: a bucket whose
  // refunds outweigh its purchases reports negative expenses.
  let yMax = 0;
  let yMin = 0;
  if (isStacked) {
    // A stack's running total peaks at the sum of its positive segments and bottoms out at the sum
    // of its negative ones, whatever order they are drawn in.
    chartData.value.forEach((period) => {
      if (!period.categories) return;
      const amounts = period.categories
        .filter((cat) => renderCategoryIds.has(cat.categoryId))
        .map((cat) => getCategoryAmount(cat));
      yMax = Math.max(yMax, sumBySign({ amounts, keepPositive: true }));
      yMin = Math.min(yMin, sumBySign({ amounts, keepPositive: false }));
    });
  } else {
    yMax = d3.max(chartData.value, (d) => d.value) || 0;
    yMin = Math.min(d3.min(chartData.value, (d) => d.value) || 0, 0);
  }

  const yScale = d3
    .scaleLinear()
    .domain([yMin, Math.max(yMax, 0)])
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

  // Zero line, drawn whenever the domain crosses zero
  if (yMin < 0) {
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(0))
      .attr('y2', yScale(0))
      .attr('stroke', colors.grid)
      .attr('stroke-width', 1);
  }

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

  // Average line - rendered BEFORE bars so it appears below them.
  // This prevents interference with bar hover events.
  if (showAverageLine.value && averageValue.value !== null) {
    const avgValue = averageValue.value;
    renderAverageLine({
      g,
      innerWidth,
      y: yScale(avgValue),
      label: `${t('analytics.trends.monthlyComparison.average')}: ${formatBaseCurrency(avgValue)}`,
      labelBackground: colors.averageLabelBg,
      onEnter: (event: MouseEvent) => handleAverageLabelMouseEnter(event, avgValue),
      onMove: handleMouseMove,
      onLeave: handleMouseLeave,
      hitBand: true,
      raiseOnHover: true,
    });
  }

  // Bars
  const MAX_BAR_WIDTH = 60;
  const bandwidth = xScale.bandwidth();
  const barWidth = Math.min(bandwidth, MAX_BAR_WIDTH);
  const barOffset = (bandwidth - barWidth) / 2;

  const zeroY = yScale(0);

  // Helper to create a path with only top corners rounded
  const createTopRoundedRect = ({
    x,
    y,
    width: w,
    height: h,
    radius,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
  }) => {
    const r = Math.min(radius, h / 2, w / 2);
    return `
      M ${x + r} ${y}
      L ${x + w - r} ${y}
      Q ${x + w} ${y} ${x + w} ${y + r}
      L ${x + w} ${y + h}
      L ${x} ${y + h}
      L ${x} ${y + r}
      Q ${x} ${y} ${x + r} ${y}
      Z
    `;
  };

  if (isStacked) {
    // Render stacked bars
    chartData.value.forEach((period) => {
      if (!period.categories) return;

      let currentY = zeroY; // Stack grows away from the zero line, in both directions

      // Filter to only categories with data for current metric, then sort
      const filteredCategories = period.categories.filter((cat) => renderCategoryIds.has(cat.categoryId));
      // Only an include list carries a meaningful order; otherwise keep what the API returned.
      const pickOrder = props.filters.categories.mode === 'include' ? props.filters.categories.ids : null;
      const sortedCategories = pickOrder
        ? [...filteredCategories].sort((a, b) => pickOrder.indexOf(a.categoryId) - pickOrder.indexOf(b.categoryId))
        : filteredCategories;

      // Find which segments actually have height (non-zero amounts)
      const visibleSegments = sortedCategories.filter((cat) => getCategoryAmount(cat) > 0);
      const topSegmentId = visibleSegments.length > 0 ? visibleSegments[visibleSegments.length - 1]!.categoryId : null;

      // Inner shadow height to help distinguish segments with similar colors
      const shadowHeight = 4;
      let segmentIndex = 0;
      let previousSegmentColor: string | null = null;

      sortedCategories.forEach((cat) => {
        const catAmount = getCategoryAmount(cat);
        if (catAmount === 0) return; // Skip categories with zero amount

        // Signed: a refund-dominated category has a negative amount and must pull the stack back
        // down rather than add another block on top of it.
        const signedHeight = zeroY - yScale(catAmount);
        const catHeight = Math.abs(signedHeight);
        const segmentY = signedHeight >= 0 ? currentY - signedHeight : currentY;
        currentY -= signedHeight;

        const isTopSegment = cat.categoryId === topSegmentId;
        const segmentX = xScale(period.periodStart)! + barOffset;

        if (isTopSegment) {
          // Use path for top segment with only top corners rounded
          g.append('path')
            .attr('class', 'bar-segment')
            .attr('data-category-id', cat.categoryId)
            .attr(
              'd',
              createTopRoundedRect({ x: segmentX, y: segmentY, width: barWidth, height: catHeight, radius: 4 }),
            )
            .attr('fill', cat.color)
            .style('cursor', 'pointer')
            .on('mouseenter', (event: MouseEvent) => handleStackedMouseEnter(event, period, cat))
            .on('mousemove', handleMouseMove)
            .on('mouseleave', handleStackedMouseLeave)
            .on('click', (event: MouseEvent) => handleBarClick(event, period, cat.categoryId));
        } else {
          // Regular rect for other segments (no rounding)
          g.append('rect')
            .attr('class', 'bar-segment')
            .attr('data-category-id', cat.categoryId)
            .attr('x', segmentX)
            .attr('y', segmentY)
            .attr('width', barWidth)
            .attr('height', catHeight)
            .attr('fill', cat.color)
            .style('cursor', 'pointer')
            .on('mouseenter', (event: MouseEvent) => handleStackedMouseEnter(event, period, cat))
            .on('mousemove', handleMouseMove)
            .on('mouseleave', handleStackedMouseLeave)
            .on('click', (event: MouseEvent) => handleBarClick(event, period, cat.categoryId));
        }

        // Add inner shadow only between segments with the same color
        // This helps distinguish same-color segments without affecting different-color boundaries
        if (segmentIndex > 0 && previousSegmentColor === cat.color) {
          // Create unique gradient ID for this segment's inner shadow
          const gradientId = `inner-shadow-${period.periodStart}-${cat.categoryId}`;

          // Define gradient for inner shadow (transparent at top, dark at bottom)
          const gradient = svg
            .select('defs')
            .append('linearGradient')
            .attr('id', gradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%');

          gradient.append('stop').attr('offset', '0%').attr('stop-color', 'rgba(0, 0, 0, 0)');
          gradient.append('stop').attr('offset', '100%').attr('stop-color', 'rgba(0, 0, 0, 0.3)');

          const actualShadowHeight = Math.min(shadowHeight, catHeight);
          g.append('rect')
            .attr('class', 'segment-shadow')
            .attr('x', segmentX)
            .attr('y', segmentY + catHeight - actualShadowHeight)
            .attr('width', barWidth)
            .attr('height', actualShadowHeight)
            .attr('fill', `url(#${gradientId})`)
            .style('pointer-events', 'none');
        }

        previousSegmentColor = cat.color;
        segmentIndex++;
      });
    });
  } else {
    // Render simple bars
    g.selectAll('.bar')
      .data(chartData.value)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => xScale(d.periodStart)! + barOffset)
      .attr('y', (d) => (d.value >= 0 ? yScale(d.value) : zeroY))
      .attr('width', barWidth)
      .attr('height', (d) => Math.abs(yScale(d.value) - zeroY))
      .attr('fill', colors.bar)
      .attr('rx', 4)
      .attr('ry', 4)
      .style('cursor', 'pointer')
      .on('mouseenter', handleMouseEnter)
      .on('mousemove', handleMouseMove)
      .on('mouseleave', handleMouseLeave)
      .on('click', (event: MouseEvent, d) => {
        // When exactly one category has data, pass its ID for navigation
        const singleCategoryId = chartCategories.value.length === 1 ? chartCategories.value[0]!.categoryId : undefined;
        handleBarClick(event, d, singleCategoryId);
      });
  }

  // MoM change badges with background
  const isPositiveGood = props.metric !== 'expenses';
  const badgeData = chartData.value.filter((d) => d.momChange !== undefined);
  const badgeFontSize = isMobile ? 9 : 11;
  const badgePadding = { x: 4, y: 2 };

  // Helper to get badge Y position
  const getBadgeY = (d: PeriodWithChange) => {
    if (isStacked && d.categories) {
      const sum = d.categories
        .filter((cat) => renderCategoryIds.has(cat.categoryId))
        .reduce((acc, cat) => acc + getCategoryAmount(cat), 0);
      return yScale(sum) - 8;
    }
    const barY = d.value >= 0 ? yScale(d.value) : zeroY;
    return barY - 8;
  };

  // Helper to get badge color
  const getBadgeColor = (d: PeriodWithChange) => {
    if (d.momChange === 0) return colors.text;
    if (d.momChange! > 0) {
      return isPositiveGood ? colors.positive : colors.negative;
    }
    return isPositiveGood ? colors.negative : colors.positive;
  };

  // Create groups for each badge (background + text)
  const badgeGroups = g
    .selectAll('.mom-badge-group')
    .data(badgeData)
    .enter()
    .append('g')
    .attr('class', 'mom-badge-group');

  // Add text first to measure it
  const badgeTexts = badgeGroups
    .append('text')
    .attr('class', 'mom-badge')
    .attr('x', (d) => xScale(d.periodStart)! + bandwidth / 2)
    .attr('y', (d) => getBadgeY(d))
    .attr('text-anchor', 'middle')
    .attr('font-size', `${badgeFontSize}px`)
    .attr('font-weight', '600')
    .attr('fill', (d) => getBadgeColor(d))
    .text((d) => `${d.momChange! > 0 ? '+' : ''}${d.momChange}%`);

  // Add background rectangles behind text
  badgeTexts.each(function () {
    const textEl = this as SVGTextElement;
    const bbox = textEl.getBBox();
    const group = d3.select(textEl.parentNode as SVGGElement);

    // Insert rect before text (so it appears behind)
    group
      .insert('rect', '.mom-badge')
      .attr('class', 'mom-badge-bg')
      .attr('x', bbox.x - badgePadding.x)
      .attr('y', bbox.y - badgePadding.y)
      .attr('width', bbox.width + badgePadding.x * 2)
      .attr('height', bbox.height + badgePadding.y * 2)
      .attr('fill', colors.averageLabelBg)
      .attr('rx', 3);
  });
};

// Get category ID and all its children IDs
function getCategoryWithChildrenIds(categoryId: string): string[] {
  const ids = [categoryId];
  // Find all categories where parentId matches the given category
  const children = categories.value.filter((cat) => cat.parentId === categoryId);
  for (const child of children) {
    // Recursively get children of children
    ids.push(...getCategoryWithChildrenIds(child.id));
  }
  return ids;
}

// Navigate to transactions page with filters
function navigateToTransactions({
  periodStart,
  periodEnd,
  categoryId,
}: {
  periodStart: string;
  periodEnd: string;
  categoryId?: string;
}) {
  const query: Record<string, string | string[]> = {
    start: periodStart,
    end: periodEnd,
  };

  // Add category filter if specified (including all child categories)
  // Vue Router handles arrays as ?categoryIds[]=1&categoryIds[]=2
  if (categoryId !== undefined) {
    const allCategoryIds = getCategoryWithChildrenIds(categoryId);
    query.categoryIds = allCategoryIds.map(String);
  }

  // Add transaction type filter based on metric
  if (props.metric === 'expenses') {
    query.transactionType = TRANSACTION_TYPES.expense;
  } else if (props.metric === 'income') {
    query.transactionType = TRANSACTION_TYPES.income;
  }
  // For savings, don't filter by type (shows all)

  router.push({
    name: ROUTES_NAMES.transactions,
    query,
  });
}

function handleMouseEnter(event: MouseEvent, d: PeriodWithChange) {
  // Skip if user is interacting with tooltip
  if (isTooltipInteracting.value) return;

  const startDate = parseISO(d.periodStart);
  tooltip.period = format(startDate, 'MMMM yyyy');
  tooltip.value = d.value;
  tooltip.totalValue = undefined; // No total needed for non-stacked bars
  tooltip.momChange = d.momChange;
  tooltip.categoryName = undefined;
  tooltip.categoryColor = undefined;
  tooltip.categoryId = undefined;
  tooltip.isAverage = false;
  // Store navigation data
  tooltip.periodStart = d.periodStart;
  tooltip.periodEnd = d.periodEnd;
  tooltip.visible = true;
  updateTooltipPosition(event);
}

function handleStackedMouseEnter(event: MouseEvent, period: PeriodWithChange, cat: CashFlowCategoryData) {
  // Skip if user is interacting with tooltip
  if (isTooltipInteracting.value) return;

  const startDate = parseISO(period.periodStart);
  tooltip.period = format(startDate, 'MMMM yyyy');
  tooltip.value = getCategoryAmount(cat);

  // Calculate total for the period (sum of all categories for current metric)
  const total =
    period.categories
      ?.filter((c) => chartCategories.value.some((cc) => cc.categoryId === c.categoryId))
      .reduce((acc, c) => acc + getCategoryAmount(c), 0) ?? 0;
  tooltip.totalValue = total;

  tooltip.momChange = period.momChange;
  tooltip.categoryName = cat.name;
  tooltip.categoryColor = cat.color;
  tooltip.categoryId = cat.categoryId;
  tooltip.isAverage = false;
  // Store navigation data
  tooltip.periodStart = period.periodStart;
  tooltip.periodEnd = period.periodEnd;
  tooltip.visible = true;
  updateTooltipPosition(event);

  // Reduce opacity of other segments to highlight hovered category
  if (svgRef.value) {
    const svg = d3.select(svgRef.value);
    svg
      .selectAll('.bar-segment')
      .transition()
      .duration(150)
      .style('opacity', function () {
        const segmentCategoryId = d3.select(this).attr('data-category-id');
        return segmentCategoryId === String(cat.categoryId) ? 1 : 0.3;
      });
  }
}

function handleStackedMouseLeave() {
  tooltip.visible = false;

  // Restore opacity of all segments
  if (svgRef.value) {
    const svg = d3.select(svgRef.value);
    svg.selectAll('.bar-segment').transition().duration(150).style('opacity', 1);
  }
}

// Handle bar click - navigate on desktop, show tooltip on touch
function handleBarClick(_event: MouseEvent, d: PeriodWithChange, categoryId?: string) {
  // Skip if user is interacting with tooltip
  if (isTooltipInteracting.value) return;

  if (!isTouchDevice.value) {
    // Desktop: navigate directly
    navigateToTransactions({
      periodStart: d.periodStart,
      periodEnd: d.periodEnd,
      categoryId,
    });
  }
  // Touch device: tooltip is already shown by mouseenter/touchstart
}

// Handle "View transactions" click from tooltip (touch devices)
function handleViewTransactionsClick() {
  if (tooltip.periodStart && tooltip.periodEnd) {
    navigateToTransactions({
      periodStart: tooltip.periodStart,
      periodEnd: tooltip.periodEnd,
      categoryId: tooltip.categoryId,
    });
  }
}

function handleAverageLabelMouseEnter(event: MouseEvent, avgValue: number) {
  tooltip.value = avgValue;
  tooltip.isAverage = true;
  tooltip.visible = true;
  updateTooltipPosition(event);
}

function handleMouseMove(event: MouseEvent) {
  updateTooltipPosition(event);
}

function handleMouseLeave() {
  tooltip.visible = false;
}

function handleTooltipMouseLeave() {
  isTooltipInteracting.value = false;
}

useResizeObserver(containerRef, renderChart);

// flush: 'post' waits for the v-else SVG container to mount after data loads,
// so renderChart sees the correct container dimensions on the first paint.
watch([chartData, () => props.metric, locale, () => props.filters, currentTheme], renderChart, {
  deep: true,
  flush: 'post',
});
</script>
