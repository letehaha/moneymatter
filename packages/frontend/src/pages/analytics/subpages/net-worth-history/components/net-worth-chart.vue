<template>
  <div class="flex flex-col">
    <div ref="containerRef" class="relative h-80 w-full">
      <svg ref="svgRef" class="h-full w-full" />

      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>{{ tooltip.periodLabel }}</ChartTooltipHeader>

          <ChartTooltipSection
            :label="$t('netWorthHistory.chart.assets')"
            :value="formatBaseCurrency(tooltip.assetsTotal)"
            value-class="text-app-income-color"
          />
          <ChartTooltipRow
            v-for="entry in tooltip.assetKinds"
            :key="entry.kind"
            :color="NET_WORTH_ASSET_KIND_COLORS[entry.kind]"
            :label="$t(NET_WORTH_ASSET_KIND_LABEL_KEYS[entry.kind])"
            :value="formatBaseCurrency(entry.value)"
          />

          <template v-if="tooltip.liabilityKinds.length">
            <ChartTooltipSection
              :label="$t('netWorthHistory.chart.liabilities')"
              :value="formatLiabilityValue(tooltip.liabilitiesTotal)"
              value-class="text-app-expense-color"
            />
            <ChartTooltipRow
              v-for="entry in tooltip.liabilityKinds"
              :key="entry.kind"
              color="var(--app-expense-color)"
              :label="$t(ACCOUNT_CATEGORIES_TRANSLATION_KEYS[entry.kind])"
              :value="formatLiabilityValue(entry.value)"
            />
          </template>

          <ChartTooltipDivider />

          <ChartTooltipRow
            total
            :label="$t('netWorthHistory.chart.netWorth')"
            :value="formatBaseCurrency(tooltip.netWorth)"
            :value-class="tooltip.netWorth >= 0 ? 'text-app-income-color' : 'text-app-expense-color'"
          />
        </ChartTooltip>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
      <div v-for="kind in presentAssetKinds" :key="kind" class="flex items-center gap-2">
        <span class="inline-block size-3 rounded-sm" :style="{ backgroundColor: NET_WORTH_ASSET_KIND_COLORS[kind] }" />
        <span class="text-muted-foreground">{{ $t(NET_WORTH_ASSET_KIND_LABEL_KEYS[kind]) }}</span>
      </div>
      <div v-if="hasLiabilities" class="flex items-center gap-2">
        <span class="bg-app-expense-color inline-block size-3 rounded-sm" />
        <span class="text-muted-foreground">{{ $t('netWorthHistory.chart.liabilities') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="bg-foreground inline-block h-0.5 w-4 rounded-full" />
        <span class="text-muted-foreground">{{ $t('netWorthHistory.chart.netWorth') }}</span>
      </div>
      <div v-if="averageOwed > 0" class="flex items-center gap-2">
        <span class="bg-app-expense-color/60 inline-block h-0.5 w-4 rounded-full" />
        <span class="text-muted-foreground">{{ $t('netWorthHistory.chart.averageLiabilities') }}</span>
      </div>
      <span v-if="liabilityScale.asymmetric" class="text-muted-foreground text-xs italic">
        {{ $t('netWorthHistory.chart.liabilitiesZoomed') }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { ACCOUNT_CATEGORIES_TRANSLATION_KEYS } from '@/common/const/account-categories-verbose';
import {
  ChartTooltip,
  ChartTooltipDivider,
  ChartTooltipHeader,
  ChartTooltipRow,
  ChartTooltipSection,
} from '@/components/common/charts/chart-tooltip';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import {
  type NetWorthHistoryGranularity,
  type NetWorthLiabilityKind,
  type NetWorthAssetKind,
  NET_WORTH_ASSET_KINDS,
  NET_WORTH_LIABILITY_KINDS,
} from '@bt/shared/types';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { parseISO } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';

import {
  NET_WORTH_ASSET_KIND_COLORS,
  NET_WORTH_ASSET_KIND_LABEL_KEYS,
  type NetWorthDisplayPoint,
  computeLiabilityScale,
} from '../composables/net-worth-history-derivations';

const props = defineProps<{
  points: NetWorthDisplayPoint[];
  granularity: NetWorthHistoryGranularity;
  // Positive "owed" magnitude; 0 suppresses the dashed average line.
  averageOwed: number;
  // User setting: off keeps the owed region on the shared scale, never zoomed.
  zoomLiabilitiesScale: boolean;
}>();

const { format, locale } = useDateLocale();
const { formatBaseCurrency, getCurrencySymbol } = useFormatCurrency();

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const MAX_BAR_WIDTH = 60;
// Below this container width the chart tightens margins and shrinks tick labels.
const MOBILE_BREAKPOINT_PX = 400;
// Beyond this many buckets, per-point dots on the net-worth line become noise.
const MAX_DOTTED_POINTS = 62;
const AVERAGE_LINE_OPACITY = 0.55;
// Asymmetric mode: positive region keeps most of the plot, the owed region gets
// the rest on its own zoomed scale.
const POSITIVE_REGION_RATIO = 0.82;
// Headroom below the deepest owed bar so it doesn't touch the plot edge.
const OWED_DOMAIN_HEADROOM = 1.1;
const OWED_REGION_TINT_OPACITY = 0.08;
// The zero baseline runs this far past the plot's left edge so it meets the "$0"
// tick mark (d3's default tick size) instead of floating away from its label.
const ZERO_LINE_TICK_OVERHANG_PX = 6;

interface TooltipLiabilityEntry {
  kind: NetWorthLiabilityKind;
  value: number;
}

interface TooltipAssetEntry {
  kind: NetWorthAssetKind;
  value: number;
}

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  periodLabel: '',
  assetsTotal: 0,
  assetKinds: [] as TooltipAssetEntry[],
  liabilitiesTotal: 0,
  liabilityKinds: [] as TooltipLiabilityEntry[],
  netWorth: 0,
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

// Drives both the render path and the "scale zoomed" caption in the legend.
const liabilityScale = computed(() =>
  computeLiabilityScale({ points: props.points, zoomEnabled: props.zoomLiabilitiesScale }),
);

// Asset kinds present in the current (already kind-filtered) series, in canonical
// order — drives the legend swatches. The stacked bars iterate the same tuple.
const presentAssetKinds = computed(() =>
  NET_WORTH_ASSET_KINDS.filter((kind) => props.points.some((point) => point.assetsByKind[kind] !== undefined)),
);

// A debt-free range draws no liability bar, so its legend swatch is dropped too.
const hasLiabilities = computed(() => props.points.some((point) => point.liabilitiesTotal !== 0));

const getMargins = ({ width }: { width: number }) => {
  const isMobile = width < MOBILE_BREAKPOINT_PX;
  return { top: 12, right: isMobile ? 10 : 20, bottom: 28, left: isMobile ? 40 : 60 };
};

// X-axis tick label: compact form per granularity.
const formatAxisLabel = (date: string): string => {
  const parsed = parseISO(date);
  switch (props.granularity) {
    case 'weekly':
      return format(parsed, 'MMM d');
    case 'monthly':
      return format(parsed, 'MMM yy');
    case 'quarterly':
      return format(parsed, 'QQQ yy');
    case 'yearly':
      return format(parsed, 'yyyy');
  }
};

// Tooltip heading: fuller form per granularity. Points carry bucket-END dates,
// so the label names the snapshot date, not a span.
const formatTooltipPeriodLabel = (date: string): string => {
  const parsed = parseISO(date);
  switch (props.granularity) {
    case 'weekly':
      return format(parsed, 'MMM d, yyyy');
    case 'monthly':
      return format(parsed, 'MMMM yyyy');
    case 'quarterly':
      return format(parsed, 'QQQ yyyy');
    case 'yearly':
      return format(parsed, 'yyyy');
  }
};

const formatAxisValue = (value: number) =>
  formatAxisCurrency({ value: Math.round(value), symbol: getCurrencySymbol() });

/**
 * Liabilities are shown signed so the tooltip reads as arithmetic against the
 * assets line: an owed amount keeps its minus sign (it subtracts from net worth),
 * and a genuinely positive value (overpaid loan or card) keeps an explicit "+".
 */
const formatLiabilityValue = (value: number): string => {
  if (value > 0) return `+${formatBaseCurrency(value)}`;
  return formatBaseCurrency(value);
};

// The asset stack rises to the sum of its positive kinds and hangs to the sum of
// its negative ones; the y-domain needs both extremes so a rare negative kind
// (an overdrawn cash bucket) isn't clipped.
const positiveAssetSum = (point: NetWorthDisplayPoint): number =>
  NET_WORTH_ASSET_KINDS.reduce((sum, kind) => {
    const value = point.assetsByKind[kind] ?? 0;
    return value > 0 ? sum + value : sum;
  }, 0);

const negativeAssetSum = (point: NetWorthDisplayPoint): number =>
  NET_WORTH_ASSET_KINDS.reduce((sum, kind) => {
    const value = point.assetsByKind[kind] ?? 0;
    return value < 0 ? sum + value : sum;
  }, 0);

const renderChart = () => {
  if (!svgRef.value || !containerRef.value) return;

  const colors = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const points = props.points;
  if (points.length === 0) return;

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const isMobile = width < MOBILE_BREAKPOINT_PX;
  const fontSize = isMobile ? '10px' : '12px';
  const margin = getMargins({ width });
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3
    .scaleBand()
    .domain(points.map((point) => point.date))
    .range([0, innerWidth])
    .padding(0.2);

  const drawYAxisWithGrid = ({
    scale,
    tickValues,
    tickCount,
  }: {
    scale: d3.ScaleLinear<number, number>;
    tickValues?: number[];
    tickCount?: number;
  }) => {
    const gridAxis = d3
      .axisLeft(scale)
      .tickSize(-innerWidth)
      .tickFormat(() => '');
    const labelAxis = d3.axisLeft(scale).tickFormat((value) => formatAxisValue(value as number));
    if (tickValues) {
      gridAxis.tickValues(tickValues);
      labelAxis.tickValues(tickValues);
    }
    if (tickCount !== undefined) {
      gridAxis.ticks(tickCount);
      labelAxis.ticks(tickCount);
    }

    g.append('g')
      .attr('class', 'grid')
      .call(gridAxis)
      .call((grid) => {
        grid.select('.domain').remove();
        grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
      });

    g.append('g')
      .attr('class', 'y-axis')
      .call(labelAxis)
      .call((axis) => {
        axis.select('.domain').attr('stroke', colors.grid);
        axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
        axis.selectAll('.tick line').attr('stroke', colors.grid);
        // The "$0" label anchors the whole read of the chart — assets above it,
        // liabilities below — so it gets full-contrast text while the rest stay muted.
        axis
          .selectAll('.tick')
          .filter((value) => (value as number) === 0)
          .select('text')
          .attr('fill', colors.foreground)
          .attr('font-weight', 600);
      });
  };

  // Faint wash over everything under the baseline so the owed half reads as
  // negative territory even where the red bars are short.
  const drawOwedRegionTint = ({ baselineY }: { baselineY: number }) => {
    if (innerHeight - baselineY <= 0) return;
    g.append('rect')
      .attr('class', 'owed-region-tint')
      .attr('x', 0)
      .attr('y', baselineY)
      .attr('width', innerWidth)
      .attr('height', innerHeight - baselineY)
      .attr('fill', colors.appExpense)
      .attr('fill-opacity', OWED_REGION_TINT_OPACITY)
      .style('pointer-events', 'none');
  };

  // Signed value → pixel. On the shared scale this is one linear mapping; in
  // asymmetric mode the owed region gets its own zoomed sub-scale below the
  // baseline so small debts stay visible next to large assets.
  let yFor: (value: number) => number;
  let centerY: number;

  const { asymmetric, maxPositive, maxOwed } = liabilityScale.value;

  if (asymmetric) {
    centerY = innerHeight * POSITIVE_REGION_RATIO;
    const yPositive = d3.scaleLinear().domain([0, maxPositive]).nice().range([centerY, 0]);
    const yOwed = d3
      .scaleLinear()
      .domain([0, -maxOwed * OWED_DOMAIN_HEADROOM])
      .range([centerY, innerHeight]);
    yFor = (value) => (value >= 0 ? yPositive(value) : yOwed(value));

    drawOwedRegionTint({ baselineY: centerY });

    drawYAxisWithGrid({ scale: yPositive, tickCount: isMobile ? 4 : 5 });

    // A couple of real-valued ticks in the zoomed region signal its own scale.
    const owedTicks = yOwed.ticks(2).filter((value) => value < 0);
    drawYAxisWithGrid({ scale: yOwed, tickValues: owedTicks.length > 0 ? owedTicks : [-maxOwed] });
  } else {
    const allValues = points.flatMap((point) => [
      positiveAssetSum(point),
      negativeAssetSum(point),
      point.liabilitiesTotal,
      point.netWorth,
    ]);
    if (props.averageOwed > 0) allValues.push(-props.averageOwed);
    const yScale = d3
      .scaleLinear()
      .domain([Math.min(0, d3.min(allValues) ?? 0), Math.max(0, d3.max(allValues) ?? 0)])
      .nice()
      .range([innerHeight, 0]);
    yFor = yScale;
    centerY = yScale(0);

    drawOwedRegionTint({ baselineY: centerY });
    drawYAxisWithGrid({ scale: yScale, tickCount: isMobile ? 5 : 6 });
  }

  // X axis: thinned tick set — a weekly all-time range can hold hundreds of buckets.
  const maxTicks = isMobile ? 4 : 8;
  const tickStep = Math.max(1, Math.ceil(points.length / maxTicks));
  const tickValues = points.map((point) => point.date).filter((_, index) => index % tickStep === 0);

  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(tickValues)
        .tickFormat((value) => formatAxisLabel(value as string)),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid);
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
      axis.selectAll('.tick line').attr('stroke', colors.grid);
    });

  const bandwidth = xScale.bandwidth();
  const barWidth = Math.min(bandwidth, MAX_BAR_WIDTH);
  const barOffset = (bandwidth - barWidth) / 2;
  const barX = (point: NetWorthDisplayPoint) => xScale(point.date)! + barOffset;

  // Signed bars: positive values rise from the baseline, negative hang below it.
  // Liabilities keep their sign — an overpaid card genuinely draws above zero.
  const drawSignedBars = ({
    className,
    accessor,
    fill,
  }: {
    className: string;
    accessor: (point: NetWorthDisplayPoint) => number;
    fill: string;
  }) => {
    g.selectAll(`.${className}`)
      .data(points)
      .enter()
      .append('rect')
      .attr('class', className)
      .attr('x', barX)
      .attr('y', (point) => Math.min(yFor(accessor(point)), centerY))
      .attr('width', barWidth)
      .attr('height', (point) => Math.abs(yFor(accessor(point)) - centerY))
      .attr('fill', fill)
      .attr('rx', 2)
      .attr('ry', 2)
      .style('pointer-events', 'none');
  };

  // Stacked asset bars: each present kind is its own segment. Positive kinds stack
  // upward from the baseline; a negative kind hangs below it, continuing its own
  // downward run so a positive kind never masks it.
  interface AssetSegmentRect {
    x: number;
    y: number;
    height: number;
    color: string;
  }
  const assetSegments: AssetSegmentRect[] = [];
  for (const point of points) {
    const x = barX(point);
    let posCum = 0;
    let negCum = 0;
    for (const kind of NET_WORTH_ASSET_KINDS) {
      const value = point.assetsByKind[kind] ?? 0;
      if (value === 0) continue;
      const color = NET_WORTH_ASSET_KIND_COLORS[kind];
      const [from, to] = value > 0 ? [posCum, (posCum += value)] : [negCum, (negCum += value)];
      const yStart = yFor(from);
      const yEnd = yFor(to);
      assetSegments.push({ x, y: Math.min(yStart, yEnd), height: Math.abs(yStart - yEnd), color });
    }
  }

  g.selectAll('.bar-asset-segment')
    .data(assetSegments)
    .enter()
    .append('rect')
    .attr('class', 'bar-asset-segment')
    .attr('x', (segment) => segment.x)
    .attr('y', (segment) => segment.y)
    .attr('width', barWidth)
    .attr('height', (segment) => segment.height)
    .attr('fill', (segment) => segment.color)
    .style('pointer-events', 'none');

  drawSignedBars({
    className: 'bar-liabilities',
    accessor: (point) => point.liabilitiesTotal,
    fill: colors.appExpense,
  });

  // Zero baseline, drawn over the bars so both stacks visibly hang off it, and in
  // muted-foreground rather than grid so it reads as a divider instead of one more
  // gridline. It overhangs to the left to meet its own "$0" tick.
  // Slightly heavier in asymmetric mode — it doubles as the scale break.
  g.append('line')
    .attr('class', 'zero-line')
    .attr('x1', -ZERO_LINE_TICK_OVERHANG_PX)
    .attr('x2', innerWidth)
    .attr('y1', centerY)
    .attr('y2', centerY)
    .attr('stroke', colors.text)
    .attr('stroke-width', asymmetric ? 2 : 1.5)
    .style('pointer-events', 'none');

  // Dashed average-liabilities reference in the owed (negative) region.
  if (props.averageOwed > 0) {
    g.append('line')
      .attr('class', 'average-liabilities-line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yFor(-props.averageOwed))
      .attr('y2', yFor(-props.averageOwed))
      .attr('stroke', colors.appExpense)
      .attr('stroke-opacity', AVERAGE_LINE_OPACITY)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6,4')
      .style('pointer-events', 'none');
  }

  // Net-worth overlay: theme foreground line so it reads over both bar colours.
  const bandCenter = (point: NetWorthDisplayPoint) => xScale(point.date)! + bandwidth / 2;

  const line = d3
    .line<NetWorthDisplayPoint>()
    .x(bandCenter)
    .y((point) => yFor(point.netWorth))
    .curve(d3.curveMonotoneX);

  g.append('path')
    .datum(points)
    .attr('class', 'net-worth-line')
    .attr('fill', 'none')
    .attr('stroke', colors.foreground)
    .attr('stroke-width', 2)
    .attr('stroke-linecap', 'round')
    .style('pointer-events', 'none')
    .attr('d', line);

  if (points.length <= MAX_DOTTED_POINTS) {
    g.selectAll('.net-worth-dot')
      .data(points)
      .enter()
      .append('circle')
      .attr('class', 'net-worth-dot')
      .attr('cx', bandCenter)
      .attr('cy', (point) => yFor(point.netWorth))
      .attr('r', 2.5)
      .attr('fill', colors.foreground)
      .style('pointer-events', 'none');
  }

  // All-time-high marker: a hollow ring on the net-worth line at its peak bucket.
  if (points.length >= 2) {
    const peak = points.reduce((best, point) => (point.netWorth > best.netWorth ? point : best), points[0]!);
    g.append('circle')
      .attr('class', 'net-worth-peak')
      .attr('cx', bandCenter(peak))
      .attr('cy', yFor(peak.netWorth))
      .attr('r', 5)
      .attr('fill', 'none')
      .attr('stroke', colors.foreground)
      .attr('stroke-width', 2)
      .style('pointer-events', 'none');
  }

  // Hover crosshair + highlight dot on the net-worth line.
  const hoverLine = g
    .append('line')
    .attr('stroke', colors.text)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,4')
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .style('opacity', 0);

  const hoverDot = g
    .append('circle')
    .attr('r', 4)
    .attr('fill', colors.foreground)
    .attr('stroke', colors.card)
    .attr('stroke-width', 2)
    .style('opacity', 0);

  // One overlay owns every pointer event so hovering between thin bars still
  // snaps to the nearest bucket.
  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('mouseenter', () => {
      hoverLine.style('opacity', 0.5);
      hoverDot.style('opacity', 1);
    })
    .on('mousemove', (event: MouseEvent) => {
      const [mouseX] = d3.pointer(event);
      const index = Math.max(0, Math.min(points.length - 1, Math.floor(mouseX / xScale.step())));
      const point = points[index];
      if (!point) return;

      const cx = bandCenter(point);
      hoverLine.attr('x1', cx).attr('x2', cx);
      hoverDot.attr('cx', cx).attr('cy', yFor(point.netWorth));

      tooltip.periodLabel = formatTooltipPeriodLabel(point.date);
      tooltip.assetsTotal = point.assetsTotal;
      tooltip.assetKinds = NET_WORTH_ASSET_KINDS.filter((kind) => point.assetsByKind[kind] !== undefined).map(
        (kind) => ({ kind, value: point.assetsByKind[kind] ?? 0 }),
      );
      tooltip.liabilitiesTotal = point.liabilitiesTotal;
      tooltip.liabilityKinds = NET_WORTH_LIABILITY_KINDS.filter(
        (kind) => point.liabilitiesByKind[kind] !== undefined,
      ).map((kind) => ({ kind, value: point.liabilitiesByKind[kind] ?? 0 }));
      tooltip.netWorth = point.netWorth;
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

// `flush: 'post'` so the container has been laid out with the new data before
// the render reads its dimensions — the stat cards above can change height.
watch(
  [
    () => props.points,
    () => props.granularity,
    () => props.averageOwed,
    () => props.zoomLiabilitiesScale,
    locale,
    currentTheme,
  ],
  renderChart,
  {
    deep: true,
    flush: 'post',
  },
);
</script>
