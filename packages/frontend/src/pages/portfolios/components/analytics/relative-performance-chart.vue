<script setup lang="ts">
import { currentTheme } from '@/common/utils/color-theme';
import { formatSignedPercent } from '@/common/utils/percentage';
import type { SecurityLogoSource } from '@/common/utils/security-logo-url';
import { ChartTooltip, ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import SecurityLogo from '@/components/common/security-logo.vue';
import { Button } from '@/components/lib/ui/button';
import * as Combobox from '@/components/lib/ui/combobox';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { getChartColors } from '@/composable/charts/chart-colors';
import { COMPACT_CHART_WIDTH_PX, formatTimeAxisLabel } from '@/composable/charts/format-time-axis-label';
import { useChartTooltipPosition } from '@/composable/charts/use-chart-tooltip-position';
import { useSecuritiesPrices } from '@/composable/data-queries/security-prices';
import { getGainColorClass } from '@/composable/gain-color';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import {
  PORTFOLIO_BENCHMARKS,
  type PortfolioAnalyticsHoldingModel,
  type PortfolioBenchmarkSeriesModel,
} from '@bt/shared/types/investments';
import { Loader2Icon, PlusIcon, SearchIcon, TriangleAlertIcon, XIcon } from '@lucide/vue';
import { StorageSerializers, useLocalStorage, useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { toPricePoints } from '../holding-detail/holding-derivations';
import {
  BENCHMARK_SERIES_COLOR,
  MAX_COMPARED_HOLDINGS,
  PORTFOLIO_SERIES_COLOR,
  buildColorMap,
  getHoldingLabel,
  rebasePriceSeries,
  resolveComparedIds,
} from './analytics-derivations';

const props = defineProps<{
  portfolioId: string;
  holdings: PortfolioAnalyticsHoldingModel[];
  returnSeries: { date: string; value: string }[];
  logoSources: Map<string, SecurityLogoSource>;
  benchmark?: PortfolioBenchmarkSeriesModel;
}>();

const { t } = useI18n();
const { format, locale } = useDateLocale();

const CHART_HEIGHT_PX = 300;
const PORTFOLIO_LINE_KEY = 'portfolio';
const DRAW_ORDER = { holding: 0, benchmark: 1, portfolio: 2 } as const;

interface ChartLine {
  key: string;
  label: string;
  /** The fund that stands in for a benchmark index. */
  proxyLabel?: string;
  color: string;
  kind: keyof typeof DRAW_ORDER;
  points: { date: string; value: number }[];
  priceStatus?: 'loading' | 'error';
  retry?: () => void;
}

const containerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const tooltipRef = ref<HTMLDivElement | null>(null);
const hiddenKeys = ref<string[]>([]);

const storedIds = useLocalStorage<string[] | null>(
  () => `portfolio-analytics:compared-holdings:${props.portfolioId}`,
  null,
  { serializer: StorageSerializers.object },
);
const comparedIds = computed(() =>
  resolveComparedIds({ stored: storedIds.value, heldIds: props.holdings.map(({ securityId }) => securityId) }),
);
const canAddMore = computed(() => comparedIds.value.length < MAX_COMPARED_HOLDINGS);

const holdingsById = computed(() => new Map(props.holdings.map((holding) => [holding.securityId, holding])));

const removeHolding = ({ securityId }: { securityId: string }) => {
  storedIds.value = comparedIds.value.filter((id) => id !== securityId);
  hiddenKeys.value = hiddenKeys.value.filter((key) => key !== securityId);
};

const isPickerOpen = ref(false);
const searchTerm = ref('');
const pickableHoldings = computed(() => {
  const term = searchTerm.value.trim().toLowerCase();
  return props.holdings.filter(
    ({ securityId, symbol, name }) =>
      !comparedIds.value.includes(securityId) &&
      (!term || [symbol, name].some((text) => text?.toLowerCase().includes(term))),
  );
});
const hasPickableHoldings = computed(() => props.holdings.length > comparedIds.value.length);

const addHolding = ({ securityId }: { securityId: string }) => {
  storedIds.value = [...comparedIds.value, securityId];
  searchTerm.value = '';
  if (!canAddMore.value) isPickerOpen.value = false;
};

const priceQueries = useSecuritiesPrices({ securityIds: comparedIds });

const benchmarkLine = computed<ChartLine | null>(() => {
  if (!props.benchmark?.series.length) return null;
  const { name, providerSymbol, isFundProxy } = PORTFOLIO_BENCHMARKS[props.benchmark.key];
  return {
    key: `benchmark:${props.benchmark.key}`,
    label: name,
    proxyLabel: isFundProxy
      ? t('portfolioDetail.analytics.relative.benchmarkProxy', { symbol: providerSymbol })
      : undefined,
    color: BENCHMARK_SERIES_COLOR,
    kind: 'benchmark',
    points: props.benchmark.series.map(({ date, value }) => ({ date, value: Number(value) })),
  };
});
const isBenchmarkUnavailable = computed(() => props.benchmark?.series.length === 0);

const lines = computed<ChartLine[]>(() => {
  const portfolioPoints = props.returnSeries.map(({ date, value }) => ({ date, value: Number(value) }));
  const startDate = portfolioPoints[0]?.date;
  const endDate = portfolioPoints.at(-1)?.date;
  const colors = buildColorMap({ keys: comparedIds.value });

  const holdingLines = comparedIds.value.map((securityId, index) => {
    const query = priceQueries.value[index];
    const prices = query?.data;
    return {
      key: securityId,
      label: getHoldingLabel(holdingsById.value.get(securityId) ?? {}),
      color: colors.get(securityId)!,
      kind: 'holding' as const,
      priceStatus:
        query?.isError && !query.isFetching
          ? ('error' as const)
          : !prices && query?.isFetching
            ? ('loading' as const)
            : undefined,
      retry: () => query?.refetch(),
      // The portfolio's own range, so a long price history can't stretch the axis past it.
      points:
        prices && startDate && endDate
          ? rebasePriceSeries({ points: toPricePoints({ prices }), startDate, endDate })
          : [],
    };
  });

  return [
    {
      key: PORTFOLIO_LINE_KEY,
      label: t('portfolioDetail.analytics.relative.portfolio'),
      color: PORTFOLIO_SERIES_COLOR,
      kind: 'portfolio',
      points: portfolioPoints,
    },
    ...(benchmarkLine.value ? [benchmarkLine.value] : []),
    ...holdingLines,
  ];
});

const latestValue = ({ line }: { line: ChartLine }) => line.points.at(-1)?.value ?? null;

const visibleLines = computed(() => lines.value.filter((line) => !hiddenKeys.value.includes(line.key)));

const toggleLine = ({ key }: { key: string }) => {
  hiddenKeys.value = hiddenKeys.value.includes(key)
    ? hiddenKeys.value.filter((hidden) => hidden !== key)
    : [...hiddenKeys.value, key];
};

const tooltip = reactive({
  visible: false,
  x: 0,
  y: 0,
  date: null as string | null,
  rows: [] as { key: string; label: string; proxyLabel?: string; color: string; value: number }[],
});
const { updateTooltipPosition } = useChartTooltipPosition({ containerRef, tooltipRef, tooltip });

const renderChart = () => {
  if (!svgRef.value || !containerRef.value) return;

  const colors = getChartColors();
  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const drawnLines = visibleLines.value
    .map((line) => ({ ...line, dates: line.points.map((point) => parseISO(point.date)) }))
    .filter((line) => line.points.length > 0);
  if (drawnLines.length === 0) return;

  const width = containerRef.value.clientWidth;
  const isCompact = width < COMPACT_CHART_WIDTH_PX;
  const margin = { top: 8, right: 12, bottom: 28, left: isCompact ? 44 : 52 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = CHART_HEIGHT_PX - margin.top - margin.bottom;
  if (innerWidth <= 0) return;

  const allDates = drawnLines.flatMap((line) => line.dates);
  const xScale = d3
    .scaleTime()
    .domain(d3.extent(allDates) as [Date, Date])
    .range([0, innerWidth]);
  const values = drawnLines.flatMap((line) => line.points.map((point) => point.value));
  const minValue = Math.min(0, d3.min(values) ?? 0);
  const maxValue = Math.max(0, d3.max(values) ?? 0);
  const yScale = d3
    .scaleLinear()
    .domain([minValue, minValue === 0 && maxValue === 0 ? 0.01 : maxValue])
    .range([innerHeight, 0])
    .nice();

  const tickCount = isCompact ? 4 : 5;
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  g.append('g')
    .call(
      d3
        .axisLeft(yScale)
        .ticks(tickCount)
        .tickSize(-innerWidth)
        .tickPadding(8)
        .tickFormat(yScale.tickFormat(tickCount, '+%')),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick line').attr('stroke', colors.grid).attr('stroke-opacity', 0.5);
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', '12px');
    });

  const [firstDate, lastDate] = xScale.domain() as [Date, Date];
  const spanDays = Math.max(1, differenceInCalendarDays(lastDate, firstDate));
  g.append('g')
    .attr('transform', `translate(0,${innerHeight})`)
    .call(
      d3
        .axisBottom<Date>(xScale)
        .ticks(isCompact ? 4 : 6)
        .tickSize(0)
        .tickPadding(10)
        .tickFormat((date) => formatTimeAxisLabel({ date: date as Date, spanDays, format })),
    )
    .call((axis) => {
      axis.select('.domain').remove();
      axis.selectAll('.tick text').attr('fill', colors.text).attr('font-size', '12px');
    });

  g.append('line')
    .attr('x1', 0)
    .attr('x2', innerWidth)
    .attr('y1', yScale(0))
    .attr('y2', yScale(0))
    .attr('stroke', colors.text)
    .attr('stroke-dasharray', '4,4');

  for (const line of [...drawnLines].sort((a, b) => DRAW_ORDER[a.kind] - DRAW_ORDER[b.kind])) {
    g.append('path')
      .datum(line.points)
      .attr('fill', 'none')
      .style('stroke', line.color)
      .attr('stroke-width', { portfolio: 3, benchmark: 2, holding: 1.5 }[line.kind])
      .attr('stroke-opacity', line.kind === 'holding' ? 0.9 : 1)
      .attr('stroke-dasharray', line.kind === 'benchmark' ? '7,4' : null)
      .attr('stroke-linejoin', 'round')
      .attr(
        'd',
        d3
          .line<{ date: string; value: number }>()
          .x((_, index) => xScale(line.dates[index]!))
          .y((point) => yScale(point.value))
          .curve(d3.curveMonotoneX),
      );
  }

  const hoverLine = g
    .append('line')
    .attr('stroke', colors.text)
    .attr('stroke-dasharray', '2,3')
    .attr('y1', 0)
    .attr('y2', innerHeight)
    .style('opacity', 0);

  const bisectDate = d3.bisector((date: Date) => date).center;

  g.append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('mousemove', (event: MouseEvent) => {
      const [mouseX] = d3.pointer(event);
      const hovered = xScale.invert(mouseX);
      const rows = drawnLines
        .map((line) => {
          const point = line.points[bisectDate(line.dates, hovered)];
          return point
            ? {
                key: line.key,
                label: line.label,
                proxyLabel: line.proxyLabel,
                color: line.color,
                value: point.value,
                date: point.date,
              }
            : null;
        })
        .filter((row) => row !== null)
        .sort((a, b) => b.value - a.value);
      const anchor = rows.find((row) => row.key === drawnLines[0]!.key) ?? rows[0];
      if (!anchor) return;

      const cx = xScale(parseISO(anchor.date));
      hoverLine.attr('x1', cx).attr('x2', cx).style('opacity', 1);
      tooltip.date = anchor.date;
      tooltip.rows = rows;
      tooltip.visible = true;
      updateTooltipPosition(event);
    })
    .on('mouseleave', () => {
      tooltip.visible = false;
      hoverLine.style('opacity', 0);
    });
};

useResizeObserver(containerRef, renderChart);

watch([visibleLines, locale, currentTheme], renderChart, { flush: 'post' });
</script>

<template>
  <div class="flex flex-col gap-3">
    <div ref="containerRef" class="relative w-full" :style="{ height: `${CHART_HEIGHT_PX}px` }">
      <svg ref="svgRef" class="h-full w-full" />

      <div
        v-show="tooltip.visible"
        ref="tooltipRef"
        class="pointer-events-none absolute z-10"
        :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
      >
        <ChartTooltip v-if="tooltip.date" class="min-w-48">
          <ChartTooltipHeader>{{ format(parseISO(tooltip.date), 'MMM d, yyyy') }}</ChartTooltipHeader>
          <ChartTooltipRow
            v-for="row in tooltip.rows"
            :key="row.key"
            :color="row.color"
            :label="row.label"
            :value="formatSignedPercent({ fraction: row.value })"
            :value-class="getGainColorClass({ gainValue: row.value })"
          >
            <template v-if="row.proxyLabel" #label-extra>
              <span class="shrink-0 text-xs">{{ row.proxyLabel }}</span>
            </template>
          </ChartTooltipRow>
        </ChartTooltip>
      </div>
    </div>

    <p v-if="isBenchmarkUnavailable" class="text-muted-foreground text-sm">
      {{ $t('portfolioDetail.analytics.relative.benchmarkUnavailable') }}
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <div
        v-for="line in lines"
        :key="line.key"
        :class="
          cn(
            'bg-card flex items-center rounded-md border border-l-4 transition-opacity',
            hiddenKeys.includes(line.key) && 'opacity-50',
          )
        "
        :style="{ borderLeftColor: line.color, borderLeftStyle: line.kind === 'benchmark' ? 'dashed' : undefined }"
      >
        <Button
          variant="ghost"
          size="xs"
          class="rounded-r-none px-2"
          :aria-pressed="!hiddenKeys.includes(line.key)"
          @click="toggleLine({ key: line.key })"
        >
          <SecurityLogo
            v-if="line.kind === 'holding' && logoSources.get(line.key)"
            :security="logoSources.get(line.key)!"
            class="size-4"
          />
          <span class="font-semibold">{{ line.label }}</span>
          <span v-if="line.proxyLabel" class="text-muted-foreground text-xs">{{ line.proxyLabel }}</span>
          <Loader2Icon v-if="line.priceStatus === 'loading'" class="text-muted-foreground size-3.5 animate-spin" />
          <span
            v-else
            :class="
              cn(
                'tabular-nums',
                latestValue({ line }) !== null && getGainColorClass({ gainValue: latestValue({ line })! }),
              )
            "
          >
            {{ formatSignedPercent({ fraction: latestValue({ line }) }) }}
          </span>
        </Button>
        <DesktopOnlyTooltip v-if="line.priceStatus === 'error'" :content="$t('portfolioHolding.chart.loadError')">
          <Button
            variant="ghost"
            size="xs"
            class="text-destructive-text rounded-none px-1.5"
            :aria-label="$t('common.actions.retry')"
            @click="line.retry?.()"
          >
            <TriangleAlertIcon class="size-3.5" />
          </Button>
        </DesktopOnlyTooltip>
        <DesktopOnlyTooltip v-if="line.kind === 'holding'" :content="$t('portfolioDetail.analytics.relative.remove')">
          <Button
            variant="ghost"
            size="xs"
            class="text-muted-foreground rounded-l-none px-1.5"
            :aria-label="$t('portfolioDetail.analytics.relative.removeNamed', { name: line.label })"
            @click="removeHolding({ securityId: line.key })"
          >
            <XIcon class="size-3.5" />
          </Button>
        </DesktopOnlyTooltip>
      </div>

      <DesktopOnlyTooltip
        v-if="hasPickableHoldings"
        :content="$t('portfolioDetail.analytics.relative.maxReached', { count: MAX_COMPARED_HOLDINGS })"
        :disabled="canAddMore"
      >
        <span class="inline-flex">
          <Combobox.Combobox v-model:open="isPickerOpen" :model-value="undefined" ignore-filter>
            <Combobox.ComboboxAnchor>
              <Button variant="outline" size="xs" :disabled="!canAddMore" @click="isPickerOpen = !isPickerOpen">
                <PlusIcon class="size-4" />
                {{ $t('portfolioDetail.analytics.relative.addHolding') }}
              </Button>
            </Combobox.ComboboxAnchor>

            <Combobox.ComboboxList align="start" class="w-72">
              <div class="relative p-2 pb-0">
                <Combobox.ComboboxInput
                  v-model="searchTerm"
                  class="border-input bg-input-background h-9 w-full rounded-md border pl-9"
                  :placeholder="$t('portfolioDetail.analytics.relative.searchPlaceholder')"
                />
                <SearchIcon class="text-muted-foreground absolute top-[60%] left-4 size-4 -translate-y-1/2" />
              </div>
              <ScrollArea class="max-h-72" viewport-class="max-h-72 p-1">
                <p v-if="pickableHoldings.length === 0" class="text-muted-foreground py-4 text-center text-sm">
                  {{ $t('portfolioDetail.analytics.relative.noMatches') }}
                </p>
                <Combobox.ComboboxItem
                  v-for="holding in pickableHoldings"
                  :key="holding.securityId"
                  :value="holding.securityId"
                  @select.prevent="addHolding({ securityId: holding.securityId })"
                >
                  <SecurityLogo
                    v-if="logoSources.get(holding.securityId)"
                    :security="logoSources.get(holding.securityId)!"
                    class="size-5"
                  />
                  <span class="font-semibold">{{ getHoldingLabel(holding) }}</span>
                  <span v-if="holding.symbol && holding.name" class="text-muted-foreground min-w-0 truncate text-xs">
                    {{ holding.name }}
                  </span>
                </Combobox.ComboboxItem>
              </ScrollArea>
            </Combobox.ComboboxList>
          </Combobox.Combobox>
        </span>
      </DesktopOnlyTooltip>
    </div>
  </div>
</template>
