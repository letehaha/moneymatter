<template>
  <div class="flex flex-col">
    <div ref="containerRef" class="relative h-64 w-full">
      <svg
        ref="svgRef"
        class="h-full w-full"
        role="img"
        :aria-label="$t('pages.budgetDetails.statistics.timelineAria')"
      />

      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none fixed z-50"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>{{ tooltip.period }}</ChartTooltipHeader>
          <ChartTooltipRow
            color="var(--primary)"
            :label="
              isSpending
                ? $t('pages.budgetDetails.statistics.expensesLabel')
                : $t('pages.budgetDetails.statistics.incomeLabel')
            "
            :value="formatBaseCurrency(tooltip.amount)"
          />
          <ChartTooltipRow
            color="var(--muted-foreground)"
            :label="$t('pages.budgetDetails.statistics.cumulativeLabel')"
            :value="formatBaseCurrency(tooltip.cumulative)"
          />
        </ChartTooltip>
      </div>
    </div>

    <div class="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <span class="flex items-center gap-1.5">
        <i class="bg-primary inline-block h-0.5 w-3" />{{
          isSpending
            ? $t('pages.budgetDetails.statistics.legend.cumulative')
            : $t('pages.budgetDetails.statistics.legend.earnedCumulative')
        }}
      </span>
      <span v-if="limit" class="flex items-center gap-1.5">
        <i class="bg-muted-foreground inline-block h-0.5 w-3" />{{
          $t('pages.budgetDetails.statistics.legend.evenPace')
        }}
      </span>
      <span v-if="projectedTotal !== null" class="flex items-center gap-1.5">
        <i :class="['inline-block h-0.5 w-3', PROJECTION_TONES[projectionTone].bg]" />{{
          $t('pages.budgetDetails.statistics.legend.projection')
        }}
      </span>
      <span class="flex items-center gap-1.5">
        <i class="bg-primary/40 inline-block h-2.5 w-3" />{{ perPeriodLabel }}
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
import { TRACKER_LIMIT_KINDS, type TrackerSpendingGranularity } from '@bt/shared/types';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { addDays, isSameMonth, max as maxDate, min as minDate, parseISO } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { type CumulativePoint, getPercent, getProjectionTone } from './tracker-insights';

const props = defineProps<{
  series: CumulativePoint[];
  limitKind: TRACKER_LIMIT_KINDS;
  granularity: TrackerSpendingGranularity;
  rangeStart: Date | null;
  rangeEnd: Date | null;
  /** Only set when the tracker has both a limit and dates. */
  limit: number | null;
  /** Only set while the tracker is in progress and has a limit. */
  projectedTotal: number | null;
}>();

const { t } = useI18n();
const isSpending = computed(() => props.limitKind === TRACKER_LIMIT_KINDS.spending);
const PROJECTION_TONES = {
  success: { bg: 'bg-success-text', stroke: 'successText' },
  warning: { bg: 'bg-warning-text', stroke: 'warningText' },
  destructive: { bg: 'bg-destructive-text', stroke: 'destructiveText' },
} as const;
const projectionTone = computed(
  () =>
    getProjectionTone({
      delta: props.projectedTotal !== null && props.limit ? props.projectedTotal - props.limit : null,
      isTarget: props.limitKind === TRACKER_LIMIT_KINDS.incomeTarget,
    }) ?? 'destructive',
);

const perPeriodLabel = computed(
  () =>
    ({
      daily: t('pages.budgetDetails.statistics.legend.daily'),
      weekly: t('pages.budgetDetails.statistics.legend.weekly'),
      monthly: t('pages.budgetDetails.statistics.legend.monthly'),
    })[props.granularity],
);
const { format } = useDateLocale();
const { formatBaseCurrency, formatWholeBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({ visible: false, x: 0, y: 0, period: '', amount: 0, cumulative: 0 });

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip, strategy: 'fixed' });

const MIN_PX_PER_X_TICK = 110;
const BAR_PADDING_RATIO = 0.15;

const formatPeriod = (point: CumulativePoint) => {
  const start = parseISO(point.periodStart);
  const end = parseISO(point.periodEnd);
  if (props.granularity === 'daily') return format(start, 'MMM d, yyyy');
  if (props.granularity === 'monthly' && isSameMonth(start, end)) return format(start, 'MMMM yyyy');
  return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
};

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || props.series.length === 0) return;

  const colors = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const margin = { top: 28, right: 16, bottom: 28, left: width < 400 ? 52 : 64 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const periodBounds = props.series.map((p) => ({
    start: parseISO(p.periodStart),
    end: addDays(parseISO(p.periodEnd), 1),
  }));
  const domainStart = minDate([...(props.rangeStart ? [props.rangeStart] : []), periodBounds[0]!.start]);
  const domainEnd = maxDate([
    ...(props.rangeEnd ? [addDays(props.rangeEnd, 1)] : []),
    periodBounds[periodBounds.length - 1]!.end,
  ]);
  const now = new Date();
  const showToday = props.projectedTotal !== null;
  const spent = props.series[props.series.length - 1]!.cumulative;

  const xScale = d3.scaleTime().domain([domainStart, domainEnd]).range([0, innerWidth]);
  const yMax = Math.max(spent, d3.max(props.series, (d) => d.amount) ?? 0, props.limit ?? 0, props.projectedTotal ?? 0);
  const yScale = d3
    .scaleLinear()
    .domain([0, yMax || 1])
    .nice()
    .range([innerHeight, 0]);

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(4)
        .tickSize(-innerWidth)
        .tickFormat((d) => formatAxisCurrency({ value: d as number, symbol: getCurrencySymbol() })),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
      axis.selectAll('.tick text').attr('fill', colors.text).style('font-size', '14px');
    });

  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom<Date>(xScale)
        .ticks(Math.max(2, Math.floor(innerWidth / MIN_PX_PER_X_TICK)))
        .tickSizeOuter(0)
        .tickFormat((d) => format(d, props.granularity === 'monthly' ? 'MMM yy' : 'MMM d')),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid);
      axis.selectAll('.tick line').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).style('font-size', '14px');
    });

  periodBounds.forEach((bounds, index) => {
    const point = props.series[index]!;
    const x0 = xScale(bounds.start);
    const bandWidth = xScale(bounds.end) - x0;
    const padding = bandWidth * BAR_PADDING_RATIO;

    g.append('rect')
      .attr('x', x0 + padding)
      .attr('y', yScale(point.amount))
      .attr('width', Math.max(1, bandWidth - padding * 2))
      .attr('height', innerHeight - yScale(point.amount))
      .attr('fill', colors.primary)
      .attr('fill-opacity', 0.3)
      .attr('rx', 2);

    g.append('rect')
      .attr('x', x0)
      .attr('y', 0)
      .attr('width', Math.max(1, bandWidth))
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .on('mouseenter', (event: MouseEvent) => {
        tooltip.period = formatPeriod(point);
        tooltip.amount = point.amount;
        tooltip.cumulative = point.cumulative;
        tooltip.visible = true;
        updateTooltipPosition(event);
      })
      .on('mousemove', (event: MouseEvent) => updateTooltipPosition(event))
      .on('mouseleave', () => {
        tooltip.visible = false;
      });
  });

  if (props.limit && props.rangeStart && props.rangeEnd) {
    const limitY = yScale(props.limit);
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', limitY)
      .attr('y2', limitY)
      .attr('stroke', colors.grid)
      .attr('stroke-dasharray', '3 4');
    g.append('text')
      .attr('x', 0)
      .attr('y', limitY - 6)
      .attr('fill', colors.text)
      .style('font-size', '14px')
      .text(t('pages.budgetDetails.statistics.limitLabel', { amount: formatWholeBaseCurrency(props.limit) }));

    g.append('line')
      .attr('x1', xScale(props.rangeStart))
      .attr('y1', yScale(0))
      .attr('x2', xScale(addDays(props.rangeEnd, 1)))
      .attr('y2', limitY)
      .attr('stroke', colors.text)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4');
  }

  const capX = (date: Date) => (showToday ? minDate([date, now]) : date);
  const linePoints: [Date, number][] = [
    [domainStart, 0],
    ...props.series.map((p, i): [Date, number] => [capX(periodBounds[i]!.end), p.cumulative]),
  ];
  g.append('path')
    .datum(linePoints)
    .attr('fill', 'none')
    .attr('stroke', colors.primary)
    .attr('stroke-width', 2.5)
    .attr('stroke-linejoin', 'round')
    .attr(
      'd',
      d3
        .line<[Date, number]>()
        .x((d) => xScale(d[0]))
        .y((d) => yScale(d[1])),
    );

  if (showToday && props.projectedTotal !== null) {
    const todayX = xScale(now);
    const spentY = yScale(spent);

    g.append('line')
      .attr('x1', todayX)
      .attr('y1', yScale(spent))
      .attr('x2', xScale(domainEnd))
      .attr('y2', yScale(props.projectedTotal))
      .attr('stroke', colors[PROJECTION_TONES[projectionTone.value].stroke])
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 3');

    g.append('line')
      .attr('x1', todayX)
      .attr('x2', todayX)
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', colors.foreground)
      .attr('stroke-dasharray', '2 3');

    g.append('circle')
      .attr('cx', todayX)
      .attr('cy', spentY)
      .attr('r', 4)
      .attr('fill', colors.primary)
      .attr('stroke', colors.card)
      .attr('stroke-width', 2);

    const label = props.limit
      ? `${formatWholeBaseCurrency(spent)} · ${Math.round(getPercent({ part: spent, total: props.limit }))}%`
      : formatWholeBaseCurrency(spent);
    const anchorEnd = todayX > innerWidth * 0.6;
    g.append('text')
      .attr('x', todayX + (anchorEnd ? -6 : 6))
      .attr('y', -8)
      .attr('text-anchor', anchorEnd ? 'end' : 'start')
      .attr('fill', colors.foreground)
      .style('font-size', '14px')
      .style('font-weight', '700')
      .text(label);
  }
};

useResizeObserver(containerRef, renderChart);

watch([() => props, currentTheme], renderChart, { deep: true });
</script>
