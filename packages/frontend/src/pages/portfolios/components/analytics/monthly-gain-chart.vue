<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import { getChartColors } from '@/composable/charts/chart-colors';
import { formatCompactTick } from '@/composable/charts/format-compact-tick';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { areAmountsHidden, maskAmountText } from '@/js/helpers/formatters';
import { useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { parseISO } from 'date-fns';
import { reactive, ref, watch } from 'vue';

import { useHeroFormat } from '../portfolio-hero/use-hero-format';
import { type MonthlyGain, getLabelStep } from './analytics-derivations';

const props = defineProps<{ months: MonthlyGain[]; currencyCode: string }>();

const { format, locale } = useDateLocale();
const { formatSignedMoney, currencySymbol } = useHeroFormat({ currencyCode: () => props.currencyCode });

const CHART_HEIGHT_PX = 220;
const MIN_LABEL_WIDTH_PX = 44;
const MONTHS_PER_YEAR = 12;
const TICK_COUNT = 4;

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);

const tooltip = reactive({ visible: false, x: 0, y: 0, entry: null as MonthlyGain | null });
const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const monthDate = ({ month }: { month: string }) => parseISO(`${month}-01`);

const renderChart = () => {
  if (!svgRef.value || !containerRef.value) return;

  const colors = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const months = props.months;
  if (months.length === 0) return;

  const width = containerRef.value.clientWidth;
  const margin = { top: 8, right: 4, bottom: 24, left: 52 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = CHART_HEIGHT_PX - margin.top - margin.bottom;
  if (innerWidth <= 0) return;

  const xScale = d3
    .scaleBand<string>()
    .domain(months.map(({ month }) => month))
    .range([0, innerWidth])
    .padding(0.3);

  const gains = months.map(({ gain }) => gain);
  const minGain = Math.min(0, d3.min(gains) ?? 0);
  const maxGain = Math.max(0, d3.max(gains) ?? 0);
  const yScale = d3
    .scaleLinear()
    .domain([minGain, minGain === 0 && maxGain === 0 ? 1 : maxGain])
    .range([innerHeight, 0])
    .nice(TICK_COUNT);

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  const ticks = yScale.ticks(TICK_COUNT);
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : 0;
  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(TICK_COUNT)
        .tickSize(-innerWidth)
        .tickPadding(8)
        .tickFormat((value) =>
          maskAmountText({ text: formatCompactTick({ value: Number(value), step, symbol: currencySymbol() }) }),
        ),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', '12px');
    });

  g.append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', yScale(0))
    .attr('y2', yScale(0))
    .attr('stroke', colors.text);

  const labelStep = getLabelStep({ count: months.length, width: innerWidth, minLabelWidth: MIN_LABEL_WIDTH_PX });
  const labelFormat = months.length > MONTHS_PER_YEAR ? 'MMM yy' : 'MMM';
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom(xScale)
        .tickSize(0)
        .tickPadding(8)
        .tickValues(months.filter((_, index) => index % labelStep === 0).map(({ month }) => month))
        .tickFormat((month) => format(monthDate({ month }), labelFormat)),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', '12px');
    });

  const bars = g
    .selectAll('.gain-bar')
    .data(months)
    .enter()
    .append('rect')
    .attr('x', ({ month }) => xScale(month)!)
    .attr('y', ({ gain }) => Math.min(yScale(gain), yScale(0)))
    .attr('width', xScale.bandwidth())
    .attr('height', ({ gain }) => Math.max(1, Math.abs(yScale(gain) - yScale(0))))
    .attr('rx', 3)
    .attr('fill', ({ gain }) => (gain >= 0 ? colors.appIncome : colors.appExpense));

  g.selectAll('.gain-hit')
    .data(months)
    .enter()
    .append('rect')
    .attr('x', ({ month }) => xScale(month)! - (xScale.step() - xScale.bandwidth()) / 2)
    .attr('y', 0)
    .attr('width', xScale.step())
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .on('mousemove', (event: MouseEvent, entry) => {
      bars.attr('fill-opacity', (bar) => (bar.month === entry.month ? 1 : 0.45));
      tooltip.entry = entry;
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('mouseleave', () => {
      bars.attr('fill-opacity', 1);
      tooltip.visible = false;
    });
};

useResizeObserver(containerRef, renderChart);

watch([() => props.months, () => props.currencyCode, locale, currentTheme, areAmountsHidden], renderChart, {
  flush: 'post',
});
</script>

<template>
  <div ref="containerRef" class="relative w-full" :style="{ height: `${CHART_HEIGHT_PX}px` }">
    <svg ref="svgRef" class="h-full w-full" />

    <div
      v-show="tooltip.visible"
      ref="tooltipRef"
      class="pointer-events-none absolute z-10"
      :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
    >
      <ChartTooltip v-if="tooltip.entry" class="min-w-48">
        <ChartTooltipHeader>{{ format(monthDate({ month: tooltip.entry.month }), 'MMMM yyyy') }}</ChartTooltipHeader>
        <ChartTooltipRow
          :label="$t('portfolioDetail.analytics.monthly.marketGain')"
          :value="formatSignedMoney({ amount: tooltip.entry.gain })"
          :value-class="getGainColorClass({ gainValue: tooltip.entry.gain })"
        />
      </ChartTooltip>
    </div>
  </div>
</template>
