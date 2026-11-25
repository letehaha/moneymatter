<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import {
  ChartTooltip,
  ChartTooltipDivider,
  ChartTooltipHeader,
  ChartTooltipRow,
} from '@/components/common/charts/chart-tooltip';
import { buildLinearScale } from '@/composable/charts/build-linear-scale';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatCompactTick } from '@/composable/charts/format-compact-tick';
import { COMPACT_CHART_WIDTH_PX, formatTimeAxisLabel } from '@/composable/charts/format-time-axis-label';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useDateLocale } from '@/composable/use-date-locale';
import { toLocalNumber } from '@/js/helpers';
import { areAmountsHidden, maskAmountText } from '@/js/helpers/formatters';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { computed, reactive, ref, useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { useHeroFormat } from '../portfolio-hero/use-hero-format';
import { type PricePoint, type Trade, type TradeDay, groupTradesByDay } from './holding-derivations';

const props = defineProps<{
  points: PricePoint[];
  trades: Trade[];
  averageCost: number | null;
  currencyCode: string;
  series: { buys: boolean; sells: boolean; averageCost: boolean };
  height: number;
}>();

const { t } = useI18n();
const { format, locale } = useDateLocale();
const { formatMoney, currencySymbol } = useHeroFormat({ currencyCode: () => props.currencyCode });

const MARKER_RADIUS_PX = { min: 4, max: 10 } as const;

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);
const gradientId = `holding-price-gradient-${useId()}`;

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  point: null as PricePoint | null,
  day: null as TradeDay | null,
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const visibleTrades = computed(() => {
  const first = props.points[0]?.date;
  const last = props.points.at(-1)?.date;
  if (!first || !last) return [];
  return props.trades.filter(
    (trade) =>
      trade.date >= first &&
      trade.date <= last &&
      (trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy ? props.series.buys : props.series.sells),
  );
});

const tradeDays = computed(() => groupTradesByDay({ trades: visibleTrades.value }));

const closeByDate = computed(() => new Map(props.points.map((point) => [point.date, point.close])));

const FONT_SIZE = '12px';

const isBuy = ({ trade }: { trade: Trade }) => trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy;

const formatQuantity = ({ quantity }: { quantity: number }) => toLocalNumber(quantity, { maximumFractionDigits: 8 });

const renderChart = () => {
  if (!svgRef.value || !containerRef.value) return;

  const colors = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const points = props.points;
  if (points.length === 0) return;

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isCompact = width < COMPACT_CHART_WIDTH_PX;
  const margin = { top: 12, right: 12, bottom: 28, left: isCompact ? 44 : 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  if (innerWidth <= 0 || innerHeight <= 0) return;

  const days = tradeDays.value;
  const showAverageCost = props.series.averageCost && props.averageCost !== null && props.averageCost > 0;

  const dates = points.map((point) => parseISO(point.date));
  const xScale = d3
    .scaleTime()
    .domain(d3.extent(dates) as [Date, Date])
    .range([0, innerWidth]);

  const yScale = buildLinearScale({
    values: [
      ...points.map((point) => point.close),
      ...days.map((day) => day.averagePrice),
      ...(showAverageCost ? [props.averageCost!] : []),
    ],
    height: innerHeight,
  });

  const maxQuantity = d3.max(groupTradesByDay({ trades: props.trades }), (day) => day.quantity) ?? 1;
  const radius = d3.scaleSqrt().domain([0, maxQuantity]).range([MARKER_RADIUS_PX.min, MARKER_RADIUS_PX.max]);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const tickCount = isCompact ? 4 : 5;
  const [firstTick, secondTick] = yScale.ticks(tickCount);
  const step = firstTick !== undefined && secondTick !== undefined ? secondTick - firstTick : 0;

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(tickCount)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((grid) => {
      grid.select('.domain').remove();
      grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
    });

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(tickCount)
        .tickSize(0)
        .tickPadding(8)
        .tickFormat((value) =>
          maskAmountText({ text: formatCompactTick({ value: Number(value), step, symbol: currencySymbol() }) }),
        ),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', FONT_SIZE);
    });

  const spanDays = Math.max(1, differenceInCalendarDays(dates.at(-1)!, dates[0]!));
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom<Date>(xScale)
        .ticks(isCompact ? 4 : 7)
        .tickSize(0)
        .tickPadding(10)
        .tickFormat((date) => formatTimeAxisLabel({ date: date as Date, spanDays, format })),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', FONT_SIZE);
    });

  const x = (_: PricePoint, index: number) => xScale(dates[index]!);

  const gradient = svg
    .append('defs')
    .append('linearGradient')
    .attr('id', gradientId)
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', 0)
    .attr('y2', 1);
  gradient.append('stop').attr('offset', 0).attr('stop-color', colors.primary).attr('stop-opacity', 0.24);
  gradient.append('stop').attr('offset', 1).attr('stop-color', colors.primary).attr('stop-opacity', 0);

  g.append('path')
    .datum(points)
    .attr('fill', `url(#${gradientId})`)
    .attr(
      'd',
      d3
        .area<PricePoint>()
        .x(x)
        .y0(innerHeight)
        .y1((point) => yScale(point.close))
        .curve(d3.curveMonotoneX),
    );

  if (showAverageCost) {
    const y = yScale(props.averageCost!);
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', colors.warningText)
      .attr('stroke-opacity', 0.8)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6,5');
    g.append('text')
      .attr('x', innerWidth - 4)
      .attr('y', y - 6)
      .attr('text-anchor', 'end')
      .attr('fill', colors.warningText)
      .attr('font-size', FONT_SIZE)
      .attr('font-weight', 700)
      .text(t('portfolioHolding.chart.averageCostLabel', { price: formatMoney({ amount: props.averageCost! }) }));
  }

  g.append('path')
    .datum(points)
    .attr('fill', 'none')
    .attr('stroke', colors.primary)
    .attr('stroke-width', 2)
    .attr('stroke-linejoin', 'round')
    .attr(
      'd',
      d3
        .line<PricePoint>()
        .x(x)
        .y((point) => yScale(point.close))
        .curve(d3.curveMonotoneX),
    );

  const hoverLine = g
    .append('line')
    .attr('stroke', colors.text)
    .attr('stroke-dasharray', '2,3')
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .style('opacity', 0);
  const hoverDot = g
    .append('circle')
    .attr('r', 5)
    .attr('fill', colors.primary)
    .attr('stroke', colors.card)
    .attr('stroke-width', 2)
    .style('opacity', 0);

  const hideHover = () => {
    tooltip.visible = false;
    hoverLine.style('opacity', 0);
    hoverDot.style('opacity', 0);
  };

  const bisectDate = d3.bisector((date: Date) => date).center;

  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('mousemove', (event: MouseEvent) => {
      const [mouseX] = d3.pointer(event);
      const index = bisectDate(dates, xScale.invert(mouseX));
      const point = points[index];
      if (!point) return;

      const cx = xScale(dates[index]!);
      hoverLine.attr('x1', cx).attr('x2', cx).style('opacity', 1);
      hoverDot.attr('cx', cx).attr('cy', yScale(point.close)).style('opacity', 1);
      tooltip.day = null;
      tooltip.point = point;
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('mouseleave', hideHover);

  const markers = g
    .selectAll('.trade-marker')
    .data(days)
    .enter()
    .append('g')
    .attr('transform', (day) => `translate(${xScale(parseISO(day.date))},${yScale(day.averagePrice)})`)
    .attr('cursor', 'pointer')
    .on('mouseenter mousemove', (event: MouseEvent, day) => {
      hoverLine.style('opacity', 0);
      hoverDot.style('opacity', 0);
      tooltip.point = null;
      tooltip.day = day;
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('mouseleave', hideHover);

  markers
    .filter((day) => day.kind === 'buy')
    .append('circle')
    .attr('r', (day) => radius(day.quantity))
    .attr('fill', colors.appIncome);
  markers
    .filter((day) => day.kind === 'sell')
    .append('rect')
    .attr('x', (day) => -radius(day.quantity))
    .attr('y', (day) => -radius(day.quantity))
    .attr('width', (day) => radius(day.quantity) * 2)
    .attr('height', (day) => radius(day.quantity) * 2)
    .attr('rx', 2)
    .attr('fill', colors.appExpense);

  const halfCircle = ({ day, startAngle }: { day: TradeDay; startAngle: number }) =>
    d3.arc()({ innerRadius: 0, outerRadius: radius(day.quantity), startAngle, endAngle: startAngle + Math.PI });
  const mixed = markers.filter((day) => day.kind === 'both');
  mixed
    .append('path')
    .attr('d', (day) => halfCircle({ day, startAngle: Math.PI }))
    .attr('fill', colors.appIncome);
  mixed
    .append('path')
    .attr('d', (day) => halfCircle({ day, startAngle: 0 }))
    .attr('fill', colors.appExpense);
  mixed
    .append('circle')
    .attr('r', (day) => radius(day.quantity))
    .attr('fill', 'none');

  markers.selectAll('circle, rect').attr('stroke', colors.card).attr('stroke-width', 2);
};

useResizeObserver(containerRef, renderChart);

watch(
  [
    () => props.points,
    () => props.trades,
    () => props.averageCost,
    () => ({ ...props.series }),
    () => props.currencyCode,
    () => props.height,
    locale,
    currentTheme,
    areAmountsHidden,
  ],
  renderChart,
  { flush: 'post' },
);
</script>

<template>
  <div ref="containerRef" class="relative w-full" :style="{ height: `${height}px` }">
    <svg ref="svgRef" class="h-full w-full" />

    <div
      v-show="tooltip.visible"
      ref="tooltipRef"
      class="pointer-events-none absolute z-10"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <ChartTooltip v-if="tooltip.day" class="min-w-52">
        <ChartTooltipHeader>{{ format(parseISO(tooltip.day.date), 'MMM d, yyyy') }}</ChartTooltipHeader>
        <ChartTooltipRow
          v-for="trade in tooltip.day.trades"
          :key="trade.id"
          :color="isBuy({ trade }) ? 'var(--app-income-color)' : 'var(--app-expense-color)'"
          :label="isBuy({ trade }) ? $t('portfolioHolding.chart.buy') : $t('portfolioHolding.chart.sell')"
          :value="`${formatQuantity({ quantity: trade.quantity })} × ${formatMoney({ amount: trade.price })}`"
        />
        <ChartTooltipRow
          v-if="closeByDate.has(tooltip.day.date)"
          color="var(--primary)"
          :label="$t('portfolioHolding.chart.close')"
          :value="formatMoney({ amount: closeByDate.get(tooltip.day.date)! })"
        />
        <ChartTooltipDivider />
        <template v-if="tooltip.day.kind === 'both'">
          <ChartTooltipRow
            total
            :label="$t('portfolioHolding.chart.bought')"
            :value="formatMoney({ amount: tooltip.day.boughtAmount })"
          />
          <ChartTooltipRow
            total
            :label="$t('portfolioHolding.chart.sold')"
            :value="formatMoney({ amount: tooltip.day.soldAmount })"
          />
        </template>
        <ChartTooltipRow
          v-else
          total
          :label="$t('portfolioHolding.chart.tradeAmount')"
          :value="formatMoney({ amount: tooltip.day.boughtAmount + tooltip.day.soldAmount })"
        />
      </ChartTooltip>
      <ChartTooltip v-else-if="tooltip.point" class="min-w-44">
        <ChartTooltipHeader>{{ format(parseISO(tooltip.point.date), 'MMM d, yyyy') }}</ChartTooltipHeader>
        <ChartTooltipRow
          color="var(--primary)"
          :label="$t('portfolioHolding.chart.close')"
          :value="formatMoney({ amount: tooltip.point.close })"
        />
      </ChartTooltip>
    </div>
  </div>
</template>
