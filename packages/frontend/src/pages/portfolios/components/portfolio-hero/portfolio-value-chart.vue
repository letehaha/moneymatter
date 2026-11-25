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
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { areAmountsHidden, maskAmountText } from '@/js/helpers/formatters';
import { cn } from '@/lib/utils';
import { useElementSize, useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { computed, reactive, ref, useId, watch } from 'vue';

import { type ChartMode, type ChartPoint } from './portfolio-hero-derivations';
import { useHeroFormat } from './use-hero-format';

const props = defineProps<{
  points: ChartPoint[];
  currencyCode: string;
  mode: ChartMode;
  series: { value: boolean; netDeposits: boolean; costBasis: boolean };
  depositsOwnScale: boolean;
  minHeight: number;
  /** Floats the `card` slot over the top-left of the plot instead of leaving it to the parent. */
  floatingCard: boolean;
}>();

defineSlots<{ card?: () => unknown }>();

const { format, locale } = useDateLocale();
const { formatMoney, formatSignedMoney, formatPercent, currencySymbol } = useHeroFormat({
  currencyCode: () => props.currencyCode,
});

const MIN_PLOT_BELOW_CARD_PX = 160;
const FONT_SIZE = '12px';

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);
const cardRef = ref<HTMLDivElement | null>(null);
const gradientId = `portfolio-value-gradient-${useId()}`;

const { height: cardHeight } = useElementSize(cardRef, undefined, { box: 'border-box' });

const chartHeight = computed(() =>
  props.floatingCard ? Math.max(props.minHeight, cardHeight.value + MIN_PLOT_BELOW_CARD_PX) : props.minHeight,
);

const plotInset = ref({ left: 0, right: 0 });
const isHovering = ref(false);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  point: null as ChartPoint | null,
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

type Scale = d3.ScaleLinear<number, number>;

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
  const isReturn = props.mode === 'return';
  const ownScale = !isReturn && props.depositsOwnScale && props.series.netDeposits;

  const margin = { top: 8, right: ownScale ? (isCompact ? 44 : 56) : 12, bottom: 28, left: isCompact ? 44 : 56 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  if (innerWidth <= 0 || innerHeight <= 0) return;
  plotInset.value = { left: margin.left, right: margin.right };

  const dates = points.map((point) => parseISO(point.date));
  const xScale = d3
    .scaleTime()
    .domain(d3.extent(dates) as [Date, Date])
    .range([0, innerWidth]);

  let primary: Scale;
  let deposits: Scale | null = null;
  const valueAccessor = (point: ChartPoint) => point.value;
  const depositsAccessor = (point: ChartPoint) => point.netDeposits;
  const costAccessor = (point: ChartPoint) => point.costBasis;
  const returnAccessor = (point: ChartPoint) => point.returnPct;

  if (isReturn) {
    primary = buildLinearScale({ values: points.map(returnAccessor), includeZero: true, height: innerHeight });
  } else {
    const primaryAccessors = [
      props.series.value && valueAccessor,
      props.series.costBasis && costAccessor,
      props.series.netDeposits && !ownScale && depositsAccessor,
    ].filter((accessor): accessor is (point: ChartPoint) => number => Boolean(accessor));
    const accessors = primaryAccessors.length ? primaryAccessors : [valueAccessor];
    primary = buildLinearScale({
      values: points.flatMap((point) => accessors.map((accessor) => accessor(point))),
      height: innerHeight,
    });
    if (ownScale) {
      deposits = buildLinearScale({ values: points.map(depositsAccessor), height: innerHeight });
    }
  }

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const tickCount = isCompact ? 4 : 5;
  const moneyTickFormat = (scale: Scale) => {
    const [first, second] = scale.ticks(tickCount);
    const step = first !== undefined && second !== undefined ? second - first : 0;
    return (value: d3.NumberValue) =>
      maskAmountText({ text: formatCompactTick({ value: Number(value), step, symbol: currencySymbol() }) });
  };
  const yTickFormat = isReturn ? primary.tickFormat(tickCount, '%') : moneyTickFormat(primary);

  g.append('g')
    .call(
      d3
        .axisLeft(primary)
        .ticks(tickCount)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((grid) => {
      grid.select('.domain').remove();
      grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
    });

  g.append('g')
    .call(d3.axisLeft(primary).ticks(tickCount).tickSize(0).tickPadding(8).tickFormat(yTickFormat))
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', FONT_SIZE);
    });

  if (deposits) {
    g.append('g')
      .attr('transform', `translate(${innerWidth},0)`)
      .call(d3.axisRight(deposits).ticks(tickCount).tickSize(0).tickPadding(8).tickFormat(moneyTickFormat(deposits)))
      .call((axis) => {
        axis.select('.domain').remove();
        axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', FONT_SIZE).attr('opacity', 0.75);
      });
  }

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

  const x = (_: ChartPoint, index: number) => xScale(dates[index]!);
  const lineFor = ({ accessor, scale }: { accessor: (point: ChartPoint) => number; scale: Scale }) =>
    d3
      .line<ChartPoint>()
      .x(x)
      .y((point) => scale(accessor(point)))
      .curve(d3.curveMonotoneX);

  const gradient = svg
    .append('defs')
    .append('linearGradient')
    .attr('id', gradientId)
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', 0)
    .attr('y2', 1);
  gradient.append('stop').attr('offset', 0).attr('stop-color', colors.primary).attr('stop-opacity', 0.28);
  gradient.append('stop').attr('offset', 1).attr('stop-color', colors.primary).attr('stop-opacity', 0);

  const mainAccessor = isReturn ? returnAccessor : valueAccessor;
  const showMain = isReturn || props.series.value;

  if (showMain) {
    g.append('path')
      .datum(points)
      .attr('fill', `url(#${gradientId})`)
      .attr(
        'd',
        d3
          .area<ChartPoint>()
          .x(x)
          .y0(isReturn ? primary(0) : innerHeight)
          .y1((point) => primary(mainAccessor(point)))
          .curve(d3.curveMonotoneX),
      );
  }

  if (isReturn) {
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', primary(0))
      .attr('y2', primary(0))
      .attr('stroke', colors.text)
      .attr('stroke-dasharray', '4,4');
  } else {
    if (props.series.costBasis) {
      g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', colors.text)
        .attr('stroke-opacity', 0.7)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '2,3')
        .attr('d', lineFor({ accessor: costAccessor, scale: primary }));
    }
    if (props.series.netDeposits) {
      g.append('path')
        .datum(points)
        .attr('fill', 'none')
        .attr('stroke', colors.text)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '5,5')
        .attr('d', lineFor({ accessor: depositsAccessor, scale: deposits ?? primary }));
    }
  }

  if (showMain) {
    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', colors.primary)
      .attr('stroke-width', 2)
      .attr('stroke-linejoin', 'round')
      .attr('d', lineFor({ accessor: mainAccessor, scale: primary }));
  }

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

  const bisectDate = d3.bisector((date: Date) => date).center;

  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('mouseenter', () => {
      hoverLine.style('opacity', 1);
      hoverDot.style('opacity', showMain ? 1 : 0);
    })
    .on('mousemove', (event: MouseEvent) => {
      const [mouseX] = d3.pointer(event);
      const index = bisectDate(dates, xScale.invert(mouseX));
      const point = points[index];
      if (!point) return;

      const cx = xScale(dates[index]!);
      hoverLine.attr('x1', cx).attr('x2', cx);
      hoverDot.attr('cx', cx).attr('cy', primary(mainAccessor(point)));
      tooltip.point = point;
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('mouseleave', () => {
      tooltip.visible = false;
      hoverLine.style('opacity', 0);
      hoverDot.style('opacity', 0);
    });
};

useResizeObserver(containerRef, renderChart);

watch(
  [
    () => props.points,
    () => props.mode,
    () => ({ ...props.series }),
    () => props.depositsOwnScale,
    () => props.floatingCard,
    () => props.currencyCode,
    locale,
    currentTheme,
    areAmountsHidden,
  ],
  renderChart,
  { flush: 'post' },
);
</script>

<template>
  <div
    ref="containerRef"
    class="relative w-full"
    :style="{ height: `${chartHeight}px` }"
    @mouseenter="isHovering = true"
    @mouseleave="isHovering = false"
  >
    <svg ref="svgRef" class="h-full w-full" />

    <div
      v-if="floatingCard"
      ref="cardRef"
      :class="cn('pointer-events-none absolute top-0 z-1 transition-opacity duration-200', isHovering && 'opacity-0')"
      :style="{
        left: `${plotInset.left}px`,
        width: `min(24rem, calc(100% - ${plotInset.left + plotInset.right}px))`,
      }"
    >
      <slot name="card" />
    </div>

    <div
      v-show="tooltip.visible"
      ref="tooltipRef"
      class="pointer-events-none absolute z-10"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <ChartTooltip v-if="tooltip.point" class="min-w-56">
        <ChartTooltipHeader>{{ format(parseISO(tooltip.point.date), 'MMM d, yyyy') }}</ChartTooltipHeader>
        <ChartTooltipRow
          v-if="mode === 'return'"
          :label="$t('portfolioDetail.hero.chart.return')"
          :value="formatPercent({ fraction: tooltip.point.returnPct })"
          :value-class="getGainColorClass({ gainValue: tooltip.point.returnPct })"
        />
        <ChartTooltipRow
          v-if="mode === 'return' || series.value"
          color="var(--primary)"
          :label="$t('portfolioDetail.hero.series.value')"
          :value="formatMoney({ amount: tooltip.point.value })"
        />
        <ChartTooltipRow
          v-if="mode === 'return' || series.netDeposits"
          color="var(--muted-foreground)"
          :label="$t('portfolioDetail.hero.series.netDeposits')"
          :value="formatMoney({ amount: tooltip.point.netDeposits })"
        />
        <ChartTooltipRow
          v-if="mode === 'value' && series.costBasis"
          color="color-mix(in srgb, var(--muted-foreground) 70%, transparent)"
          :label="$t('portfolioDetail.hero.series.costBasis')"
          :value="formatMoney({ amount: tooltip.point.costBasis })"
        />
        <ChartTooltipDivider />
        <ChartTooltipRow
          total
          :label="$t('portfolioDetail.hero.chart.gain')"
          :value="formatSignedMoney({ amount: tooltip.point.value - tooltip.point.netDeposits })"
          :value-class="getGainColorClass({ gainValue: tooltip.point.value - tooltip.point.netDeposits })"
        />
      </ChartTooltip>
    </div>
  </div>
</template>
