<template>
  <div v-if="props.model.bars.length > 0" class="flex flex-col">
    <div ref="containerRef" class="relative h-72 w-full">
      <svg ref="svgRef" class="h-full w-full"></svg>

      <!-- Tooltip -->
      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip class="min-w-72">
          <template v-if="tooltip.isAverage">
            <ChartTooltipHeader>{{ t('investmentContributions.average') }}</ChartTooltipHeader>
            <ChartTooltipHero>{{ formatBaseCurrency(tooltip.averageValue) }}</ChartTooltipHero>
          </template>

          <template v-else>
            <ChartTooltipHeader>{{ tooltip.period }}</ChartTooltipHeader>

            <div class="flex items-baseline justify-between gap-6">
              <ChartTooltipHero>{{ formatBaseCurrency(tooltip.total) }}</ChartTooltipHero>
              <span
                v-if="tooltip.showMomChange && tooltip.momChangePct !== undefined"
                class="flex items-baseline gap-1.5"
              >
                <span class="text-card-tooltip-muted text-[11px]">
                  {{ t('investmentContributions.chart.vsPrevious') }}
                </span>
                <span :class="['text-sm font-semibold tabular-nums', changeColorClass(tooltip.momChangePct)]">
                  {{ tooltip.momChangePct > 0 ? '+' : '' }}{{ tooltip.momChangePct }}%
                </span>
              </span>
            </div>

            <template v-if="tooltip.segments.length">
              <ChartTooltipDivider />
              <ChartTooltipRow
                v-for="segment in tooltip.segments"
                :key="segment.portfolioId"
                :color="segment.color"
                :label="segment.name"
                :value="formatBaseCurrency(segment.amount)"
              />
            </template>
          </template>
        </ChartTooltip>
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
  ChartTooltipHero,
  ChartTooltipRow,
} from '@/components/common/charts/chart-tooltip';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { renderAverageLine } from '@/composable/charts/render-average-line';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useDateLocale } from '@/composable/use-date-locale';
import type { InvestmentContributionsGranularity } from '@bt/shared/types';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { parseISO } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { type ContributionsChartModel } from '../composables/contributions-derivations';

const props = defineProps<{
  model: ContributionsChartModel;
  granularity: InvestmentContributionsGranularity;
}>();

const { t } = useI18n();
const { format, locale } = useDateLocale();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const MAX_BAR_WIDTH = 60;
// Vertical breathing room above the tallest stack so the % badges don't clip.
const BADGE_TOP_MARGIN = 40;
// Fraction added to the y-domain on each populated side so bars/badges don't touch the edges.
const Y_HEADROOM_RATIO = 0.08;
// Below this container width the chart tightens margins and shrinks tick labels.
const MOBILE_BREAKPOINT_PX = 400;

type ChartBar = ContributionsChartModel['bars'][number] & {
  // Sum of the bar's positive segments (top of the up-stack) and negative segments (bottom of the down-stack).
  posSum: number;
  negSum: number;
};

const chartBars = computed<ChartBar[]>(() =>
  props.model.bars.map((bar) => {
    let posSum = 0;
    let negSum = 0;
    for (const segment of bar.segments) {
      if (segment.amount > 0) posSum += segment.amount;
      else if (segment.amount < 0) negSum += segment.amount;
    }
    return { ...bar, posSum, negSum };
  }),
);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  period: '',
  total: 0,
  segments: [] as ContributionsChartModel['bars'][number]['segments'],
  momChangePct: undefined as number | undefined,
  // Whether the "vs previous" percentage is meaningful enough to show next to the amounts.
  showMomChange: false,
  // Hovering the average line swaps the tooltip to a single average row.
  isAverage: false,
  averageValue: 0,
});

const { updateTooltipPosition } = useChartTooltipPosition({
  containerRef,
  tooltipRef,
  tooltip,
});

const getMargins = ({ width, shouldRotate }: { width: number; shouldRotate: boolean }) => {
  const isMobile = width < MOBILE_BREAKPOINT_PX;
  return {
    top: BADGE_TOP_MARGIN,
    right: isMobile ? 10 : 20,
    left: isMobile ? 40 : 60,
    bottom: shouldRotate ? 70 : 40,
  };
};

// X-axis tick label: compact form per granularity.
const formatAxisLabel = (periodStart: string): string => {
  const date = parseISO(periodStart);
  switch (props.granularity) {
    case 'quarterly':
      return format(date, 'QQQ yy');
    case 'yearly':
      return format(date, 'yyyy');
    default:
      return format(date, 'MMM yy');
  }
};

// Tooltip heading: fuller form per granularity.
const formatTooltipPeriodLabel = (periodStart: string): string => {
  const date = parseISO(periodStart);
  switch (props.granularity) {
    case 'quarterly':
      return format(date, 'QQQ yyyy');
    case 'yearly':
      return format(date, 'yyyy');
    default:
      return format(date, 'MMMM yyyy');
  }
};

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: getCurrencySymbol() });

// Tailwind class for the tooltip "vs previous" row, matching the badge color convention.
const changeColorClass = (pct: number): string => {
  if (pct > 0) return 'text-app-income-color';
  if (pct < 0) return 'text-app-expense-color';
  return 'text-card-tooltip-muted';
};

const renderChart = () => {
  if (!svgRef.value || !containerRef.value || chartBars.value.length === 0) return;

  const { grid, text, card, appIncome, appExpense } = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < MOBILE_BREAKPOINT_PX;

  const spacePerLabel = width / chartBars.value.length;
  const shouldRotateLabels = spacePerLabel < 55 || chartBars.value.length >= 12;

  const margin = getMargins({ width, shouldRotate: shouldRotateLabels });
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // X scale
  const xScale = d3
    .scaleBand()
    .domain(chartBars.value.map((b) => b.periodStart))
    .range([0, innerWidth])
    .padding(0.3);

  // Y scale — always spans 0 and both stacking directions.
  const yMaxRaw = Math.max(0, d3.max(chartBars.value, (b) => b.posSum) ?? 0);
  const yMinRaw = Math.min(0, d3.min(chartBars.value, (b) => b.negSum) ?? 0);
  let domainMax = yMaxRaw > 0 ? yMaxRaw * (1 + Y_HEADROOM_RATIO) : 0;
  const domainMin = yMinRaw < 0 ? yMinRaw * (1 + Y_HEADROOM_RATIO) : 0;
  // All-zero data would collapse the domain; give it a nominal top so the axis still renders.
  if (domainMax === 0 && domainMin === 0) domainMax = 1;

  const yScale = d3.scaleLinear().domain([domainMin, domainMax]).nice().range([innerHeight, 0]);

  // Grid lines
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

  // X axis
  const labelRotation = shouldRotateLabels ? -45 : 0;
  const fontSize = isMobile ? '10px' : '12px';

  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).tickFormat((d) => formatAxisLabel(d as string)))
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
      axis.select('.domain').attr('stroke', grid);
      axis.selectAll('.tick text').attr('fill', text).attr('font-size', fontSize);
      axis.selectAll('.tick line').attr('stroke', grid);
    });

  // Zero baseline
  g.append('line')
    .attr('class', 'zero-line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', yScale(0))
    .attr('y2', yScale(0))
    .attr('stroke', grid)
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');

  // Diverging stacked bars
  const bandwidth = xScale.bandwidth();
  const barWidth = Math.min(bandwidth, MAX_BAR_WIDTH);
  const barOffset = (bandwidth - barWidth) / 2;

  chartBars.value.forEach((bar) => {
    const barX = xScale(bar.periodStart)! + barOffset;
    let posCursor = 0;
    let negCursor = 0;

    bar.segments.forEach((segment) => {
      if (segment.amount === 0) return;

      let y: number;
      let segHeight: number;
      if (segment.amount > 0) {
        y = yScale(posCursor + segment.amount);
        segHeight = yScale(posCursor) - y;
        posCursor += segment.amount;
      } else {
        y = yScale(negCursor);
        segHeight = yScale(negCursor + segment.amount) - y;
        negCursor += segment.amount;
      }

      g.append('rect')
        .attr('class', 'bar-segment')
        .attr('x', barX)
        .attr('y', y)
        .attr('width', barWidth)
        .attr('height', segHeight)
        .attr('fill', segment.color)
        .style('pointer-events', 'none');
    });
  });

  // Transparent per-bar hit areas span the full band and plot height so the whole
  // column is hoverable, including gaps between diverging segments.
  g.selectAll('.bar-hit')
    .data(chartBars.value)
    .enter()
    .append('rect')
    .attr('class', 'bar-hit')
    .attr('x', (b) => xScale(b.periodStart)!)
    .attr('y', 0)
    .attr('width', bandwidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .on('mouseenter', handleMouseEnter)
    .on('mousemove', handleMouseMove)
    .on('mouseleave', handleMouseLeave);

  // Per-bar % change badges
  const badgeData = chartBars.value.filter((b) => b.showMomChangeLabel);
  const badgeFontSize = isMobile ? 9 : 11;
  const badgePadding = { x: 4, y: 2 };

  const getBadgeY = (b: ChartBar) => (b.posSum > 0 ? yScale(b.posSum) : yScale(0)) - 8;

  // Contributions read "more = good", so a rising period is the income colour and a falling one the expense colour.
  const getBadgeColor = (b: ChartBar) => {
    if (b.momChangePct === 0) return text;
    return b.momChangePct! > 0 ? appIncome : appExpense;
  };

  const badgeGroups = g
    .selectAll('.change-badge-group')
    .data(badgeData)
    .enter()
    .append('g')
    .attr('class', 'change-badge-group')
    .style('pointer-events', 'none');

  const badgeTexts = badgeGroups
    .append('text')
    .attr('class', 'change-badge')
    .attr('x', (b) => xScale(b.periodStart)! + bandwidth / 2)
    .attr('y', (b) => getBadgeY(b))
    .attr('text-anchor', 'middle')
    .attr('font-size', `${badgeFontSize}px`)
    .attr('font-weight', '600')
    .attr('fill', (b) => getBadgeColor(b))
    .text((b) => `${b.momChangePct! > 0 ? '+' : ''}${b.momChangePct}%`);

  // Pill backgrounds sized to the measured text and inserted behind it.
  badgeTexts.each(function () {
    const textEl = this as SVGTextElement;
    const bbox = textEl.getBBox();
    const group = d3.select(textEl.parentNode as SVGGElement);

    group
      .insert('rect', '.change-badge')
      .attr('class', 'change-badge-bg')
      .attr('x', bbox.x - badgePadding.x)
      .attr('y', bbox.y - badgePadding.y)
      .attr('width', bbox.width + badgePadding.x * 2)
      .attr('height', bbox.height + badgePadding.y * 2)
      .attr('fill', card)
      .attr('rx', 3);
  });

  // Dashed average line, drawn last so it stays visible across tall bars instead
  // of hiding behind them. The wide hit-band gives the line its own tooltip
  // without stealing bar hovers elsewhere.
  if (props.model.average !== null) {
    renderAverageLine({
      g,
      innerWidth,
      y: yScale(props.model.average),
      label: `${t('investmentContributions.average')}: ${formatBaseCurrency(props.model.average)}`,
      labelBackground: card,
      onEnter: handleAverageEnter,
      onMove: handleMouseMove,
      onLeave: handleMouseLeave,
      hitBand: true,
    });
  }
};

function handleMouseEnter(event: MouseEvent, bar: ChartBar) {
  tooltip.isAverage = false;
  tooltip.period = formatTooltipPeriodLabel(bar.periodStart);
  tooltip.total = bar.total;
  tooltip.segments = bar.segments.filter((segment) => segment.amount !== 0);
  tooltip.momChangePct = bar.momChangePct;
  tooltip.showMomChange = bar.showMomChangeLabel;
  tooltip.visible = true;
  updateTooltipPosition(event);
}

function handleAverageEnter(event: MouseEvent) {
  if (props.model.average === null) return;
  tooltip.isAverage = true;
  tooltip.averageValue = props.model.average;
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

// flush: 'post' lets the SVG container mount/resize before the first draw so it
// reads correct dimensions; deep watch picks up in-place model mutations.
watch([() => props.model, () => props.granularity, locale, currentTheme], renderChart, {
  deep: true,
  flush: 'post',
});
</script>
