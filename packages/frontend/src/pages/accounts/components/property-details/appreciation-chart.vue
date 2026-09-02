<template>
  <div class="flex flex-col">
    <div ref="containerRef" class="relative h-72 w-full @md/chart-card:h-80">
      <svg ref="svgRef" class="h-full w-full"></svg>

      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip>
          <ChartTooltipHeader>{{ tooltip.dateLabel }}</ChartTooltipHeader>
          <div class="flex items-center gap-2">
            <span class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: 'var(--primary)' }" />
            <span class="font-medium tabular-nums">{{ formatAmountByCurrencyCode(tooltip.value, currencyCode) }}</span>
          </div>
          <div class="text-card-tooltip-muted mt-0.5 text-xs">
            {{ tooltip.relativeLabel }}
          </div>
        </ChartTooltip>
      </div>
    </div>

    <div class="text-muted-foreground mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
      <div class="flex items-center gap-2">
        <span class="bg-primary inline-block h-0.5 w-5 rounded-full"></span>
        <span>{{ $t('pages.propertyDetails.chart.legendValue') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="bg-muted-foreground/40 inline-block size-2 rounded-full"></span>
        <span>{{ $t('pages.propertyDetails.chart.legendPurchase') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="bg-primary border-background inline-block size-2 rounded-full border"></span>
        <span>{{ $t('pages.propertyDetails.chart.legendToday') }}</span>
      </div>
      <div v-if="revaluation" class="flex items-center gap-2">
        <span class="bg-app-income-color inline-block size-2 rotate-45"></span>
        <span>{{ $t('pages.propertyDetails.chart.legendRevaluation') }}</span>
      </div>
      <div class="flex items-center gap-2">
        <span class="border-muted-foreground/50 inline-block h-0 w-5 border-t border-dashed"></span>
        <span>{{ $t('pages.propertyDetails.chart.legendPurchasePriceLine') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { ChartTooltip, ChartTooltipHeader } from '@/components/common/charts/chart-tooltip';
import { useFormatCurrency } from '@/composable';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatAxisCurrency } from '@/composable/charts/format-axis-currency';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useResizeObserver } from '@vueuse/core';
import { differenceInCalendarDays, format } from 'date-fns';
import * as d3 from 'd3';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import type { AppreciationPoint } from '../../utils/appreciation-math';

const MOBILE_BREAKPOINT_PX = 420;
const AVERAGE_DAYS_PER_MONTH = 30.4;

const props = defineProps<{
  timeline: AppreciationPoint[];
  purchaseDate: Date;
  /** Purchase price, drawn as a dashed break-even reference line. */
  purchasePrice: number;
  /** Latest revaluation anchor (null when never revalued). Drives the kink marker. */
  revaluation?: { value: number; date: Date } | null;
  todayDate: Date;
  currencyCode: string;
}>();

const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const propCurrencySymbol = computed(() => {
  try {
    const formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: props.currencyCode,
      currencyDisplay: 'narrowSymbol',
    }).format(0);
    return formatted.replace(/[\d.,\s]/g, '').trim();
  } catch {
    return props.currencyCode;
  }
});

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  value: 0,
  dateLabel: '',
  relativeLabel: '',
});

const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const getMargins = ({ width }: { width: number }) => {
  const isMobile = width < MOBILE_BREAKPOINT_PX;
  return {
    top: 16,
    right: isMobile ? 12 : 24,
    left: isMobile ? 52 : 64,
    bottom: 28,
  };
};

const formatAxisValue = (value: number) => formatAxisCurrency({ value, symbol: propCurrencySymbol.value });

const formatRelative = (months: number): string => {
  if (months <= 0) return t('pages.propertyDetails.chart.atPurchase');
  if (months < 12) return t('pages.propertyDetails.chart.monthsLabel', { n: months });
  const years = Math.floor(months / 12);
  const remMonths = months - years * 12;
  if (remMonths === 0) return t('pages.propertyDetails.chart.yearsLabel', { n: years });
  return t('pages.propertyDetails.chart.yearsMonthsLabel', { y: years, m: remMonths });
};

const render = () => {
  if (!svgRef.value || !containerRef.value || props.timeline.length < 2) return;

  const data = props.timeline;
  const colors = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = containerRef.value.clientWidth;
  const height = containerRef.value.clientHeight;
  const margin = getMargins({ width });
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const isMobile = width < MOBILE_BREAKPOINT_PX;

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const xScale = d3
    .scaleTime()
    .domain([data[0]!.date, data[data.length - 1]!.date])
    .range([0, innerWidth]);

  const valueMax = d3.max(data, (d) => d.value) ?? 1;
  const yScale = d3
    .scaleLinear()
    .domain([0, valueMax * 1.05])
    .nice()
    .range([innerHeight, 0]);

  const fontSize = isMobile ? '10px' : '11px';

  // Horizontal grid
  g.append('g')
    .attr('class', 'grid')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(isMobile ? 4 : 5)
        .tickSize(-innerWidth)
        .tickFormat(() => ''),
    )
    .call((grid) => {
      grid.select('.domain').remove();
      grid.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.45);
    });

  // Y axis
  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(isMobile ? 4 : 5)
        .tickFormat((d) => formatAxisValue(d as number)),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick line').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
    });

  // X axis
  const yearTicks = xScale.ticks(d3.timeYear.every(isMobile ? 2 : 1) ?? d3.timeYear);
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .tickValues(yearTicks)
        .tickFormat((d) => d3.timeFormat('%Y')(d as Date)),
    )
    .call((axis) => {
      axis.select('.domain').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
      axis.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', fontSize);
    });

  // Purchase-price reference line — the break-even the curve is measured against.
  if (props.purchasePrice > 0 && props.purchasePrice < valueMax) {
    g.append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', yScale(props.purchasePrice))
      .attr('y2', yScale(props.purchasePrice))
      .attr('stroke', colors.text)
      .attr('stroke-opacity', 0.5)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4');

    g.append('text')
      .attr('x', innerWidth)
      .attr('y', yScale(props.purchasePrice) - 6)
      .attr('text-anchor', 'end')
      .attr('fill', colors.text)
      .attr('font-size', '10px')
      .text(t('pages.propertyDetails.chart.purchasePriceLine'));
  }

  // Today reference line (vertical)
  if (props.todayDate >= xScale.domain()[0]! && props.todayDate <= xScale.domain()[1]!) {
    g.append('line')
      .attr('x1', xScale(props.todayDate))
      .attr('x2', xScale(props.todayDate))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', colors.primary)
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,3');
  }

  // Gradient fill defs
  const gradId = `appr-grad-${Math.floor(innerWidth)}`;
  const defs = svg.append('defs');
  const grad = defs
    .append('linearGradient')
    .attr('id', gradId)
    .attr('x1', '0')
    .attr('y1', '0')
    .attr('x2', '0')
    .attr('y2', '1');
  grad.append('stop').attr('offset', '0%').attr('stop-color', colors.primary).attr('stop-opacity', 0.32);
  grad.append('stop').attr('offset', '100%').attr('stop-color', colors.primary).attr('stop-opacity', 0);

  // Area under curve
  const areaGen = d3
    .area<AppreciationPoint>()
    .x((d) => xScale(d.date))
    .y0(yScale(0))
    .y1((d) => yScale(d.value))
    .curve(d3.curveMonotoneX);

  g.append('path').datum(data).attr('fill', `url(#${gradId})`).attr('d', areaGen);

  // Line
  const lineGen = d3
    .line<AppreciationPoint>()
    .x((d) => xScale(d.date))
    .y((d) => yScale(d.value))
    .curve(d3.curveMonotoneX);

  g.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', colors.primary)
    .attr('stroke-width', 2.25)
    .attr('d', lineGen);

  // Purchase marker
  g.append('circle')
    .attr('cx', xScale(props.purchaseDate))
    .attr('cy', yScale(data[0]!.value))
    .attr('r', 4)
    .attr('fill', colors.text)
    .attr('fill-opacity', 0.55)
    .attr('stroke', colors.card)
    .attr('stroke-width', 1.5);

  // Revaluation kink marker (rotated square) — placed at the revaluation
  // date/value so the discontinuity in the curve is visually annotated.
  if (props.revaluation) {
    const ox = xScale(props.revaluation.date);
    const oy = yScale(props.revaluation.value);
    g.append('rect')
      .attr('x', ox - 5)
      .attr('y', oy - 5)
      .attr('width', 10)
      .attr('height', 10)
      .attr('transform', `rotate(45, ${ox}, ${oy})`)
      .attr('fill', colors.appIncome)
      .attr('stroke', colors.card)
      .attr('stroke-width', 1.5);
  }

  // Today marker (find nearest point)
  const todayPoint = data.reduce(
    (prev, curr) =>
      Math.abs(curr.date.getTime() - props.todayDate.getTime()) <
      Math.abs(prev.date.getTime() - props.todayDate.getTime())
        ? curr
        : prev,
    data[0]!,
  );
  g.append('circle')
    .attr('cx', xScale(todayPoint.date))
    .attr('cy', yScale(todayPoint.value))
    .attr('r', 5)
    .attr('fill', colors.primary)
    .attr('stroke', colors.card)
    .attr('stroke-width', 2);

  // Hover dot
  const hoverDot = g
    .append('circle')
    .attr('r', 5)
    .attr('fill', colors.primary)
    .attr('stroke', colors.card)
    .attr('stroke-width', 2)
    .style('display', 'none')
    .style('pointer-events', 'none');

  const showAt = (clientX: number, clientY: number, mouseX: number) => {
    const dateAtMouse = xScale.invert(mouseX);
    const closest = data.reduce(
      (prev, curr) =>
        Math.abs(curr.date.getTime() - dateAtMouse.getTime()) < Math.abs(prev.date.getTime() - dateAtMouse.getTime())
          ? curr
          : prev,
      data[0]!,
    );

    tooltip.value = closest.value;
    tooltip.dateLabel = format(closest.date, 'MMM yyyy');
    const daysFromPurchase = differenceInCalendarDays(closest.date, props.purchaseDate);
    const monthsFromPurchase = Math.max(0, Math.round(daysFromPurchase / AVERAGE_DAYS_PER_MONTH));
    tooltip.relativeLabel = formatRelative(monthsFromPurchase);
    tooltip.visible = true;

    hoverDot.style('display', null).attr('cx', xScale(closest.date)).attr('cy', yScale(closest.value));

    updateTooltipPosition({ clientX, clientY });
  };

  const hide = () => {
    tooltip.visible = false;
    hoverDot.style('display', 'none');
  };

  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .style('cursor', 'crosshair')
    .on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event);
      showAt(event.clientX, event.clientY, mx);
    })
    .on('mouseleave', hide)
    .on('touchstart touchmove', (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      const [tx] = d3.pointer(touch, svgRef.value!);
      showAt(touch.clientX, touch.clientY, tx - margin.left);
    })
    .on('touchend', hide);

  hoverDot.raise();
};

useResizeObserver(containerRef, render);
watch(
  [
    () => props.timeline,
    () => props.purchaseDate,
    () => props.purchasePrice,
    () => props.revaluation,
    () => props.todayDate,
    () => props.currencyCode,
    currentTheme,
  ],
  render,
  { deep: true },
);
</script>
