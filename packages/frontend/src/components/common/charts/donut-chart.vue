<template>
  <div ref="chartContainerRef" :class="cn('relative h-55 w-full', props.class)">
    <svg ref="svgRef" class="h-full w-full"></svg>

    <!-- Center label: shows Total by default, category info on hover/selection -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div class="flex flex-col items-center gap-0.5 text-center">
        <template v-if="displayedItem">
          <div class="text-muted-foreground text-xs">{{ displayedItem.name }}</div>
          <div class="text-base font-semibold">{{ formatBaseCurrency(displayedItem.amount) }}</div>
        </template>
        <template v-else>
          <div class="text-muted-foreground text-xs">{{ $t('common.labels.total') }}</div>
          <div class="text-base font-semibold">{{ formatBaseCurrency(totalAmount) }}</div>
        </template>
      </div>
    </div>

    <!-- Touch device overlay: shows navigation button below center label -->
    <div
      v-if="clickable === 'all' && isTouch && selectedItem"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div class="pointer-events-auto mt-18 flex flex-col items-center">
        <Button
          size="sm"
          variant="outline"
          class="h-6 gap-1 px-2 text-xs"
          @click="$emit('category-click', selectedItem)"
        >
          {{ $t('dashboard.widgets.expensesStructure.viewButton') }}
          <ExternalLinkIcon class="size-3" />
        </Button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import Button from '@/components/lib/ui/button/Button.vue';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { useMediaQuery, useResizeObserver } from '@vueuse/core';
import * as d3 from 'd3';
import { ExternalLinkIcon } from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';

import type { DonutChartItem } from './donut-chart-item';

const props = withDefaults(
  defineProps<{
    data: DonutChartItem[];
    totalAmount: number;
    class?: string;
    /** `drillable`: only `isDrillable` slices emit `category-click`; the rest just show their details. */
    clickable?: 'all' | 'drillable';
  }>(),
  { clickable: 'all' },
);

const emit = defineEmits<{
  'category-click': [item: DonutChartItem];
}>();

const { formatBaseCurrency } = useFormatCurrency();
const isTouch = useMediaQuery('(pointer: coarse)');

const chartContainerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const selectedItem = ref<DonutChartItem | null>(null);
const hoveredItem = ref<DonutChartItem | null>(null);
const displayedItem = computed(() => hoveredItem.value ?? selectedItem.value);

let highlight: (params: { item: DonutChartItem | null }) => void = () => {};

const renderChart = () => {
  if (!svgRef.value || !chartContainerRef.value || props.data.length === 0) return;

  const svg = d3.select(svgRef.value);
  svg.selectAll('*').remove();

  const width = chartContainerRef.value.clientWidth;
  const height = chartContainerRef.value.clientHeight;

  const glowSize = 10;
  const radius = Math.min(width, height) / 2 - glowSize;
  const innerRadius = radius * 0.7;

  const pie = d3
    .pie<DonutChartItem>()
    .value((d) => d.amount)
    .sort(null);

  const arc = d3.arc<d3.PieArcDatum<DonutChartItem>>().innerRadius(innerRadius).outerRadius(radius);

  const glowArc = d3
    .arc<d3.PieArcDatum<DonutChartItem>>()
    .innerRadius(radius)
    .outerRadius(radius + glowSize);

  const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
  const glowGroup = g.append('g').attr('class', 'glow-group');
  const pieData = pie(props.data);
  const arcs = g.selectAll('.arc').data(pieData).enter().append('g').attr('class', 'arc');

  highlight = ({ item }) => {
    glowGroup.selectAll('*').remove();
    const datum = item && pieData.find((d) => d.data.categoryId === item.categoryId);
    if (!datum) {
      g.selectAll('.arc path').style('opacity', 1);
      return;
    }
    g.selectAll<SVGPathElement, d3.PieArcDatum<DonutChartItem>>('.arc path').style('opacity', (d) =>
      d.data.categoryId === datum.data.categoryId ? 1 : 0.3,
    );
    glowGroup.append('path').attr('d', glowArc(datum)).attr('fill', datum.data.color).style('opacity', 0.5);
  };

  arcs
    .append('path')
    .attr('d', arc)
    .attr('fill', (d) => d.data.color)
    .attr('stroke', 'var(--card)')
    .attr('stroke-width', 2)
    .style('cursor', (d) => (props.clickable === 'all' || d.data.isDrillable ? 'pointer' : 'default'))
    .style('transition', 'opacity 0.2s ease')
    .on('mouseenter', (_event, d) => {
      if (isTouch.value) return;
      hoveredItem.value = d.data;
    })
    .on('mouseleave', () => {
      if (isTouch.value) return;
      hoveredItem.value = null;
    })
    .on('click', (_event, d) => onSliceClick({ item: d.data }));

  highlight({ item: displayedItem.value });
};

const onSliceClick = ({ item }: { item: DonutChartItem }) => {
  if (props.clickable === 'drillable' && item.isDrillable) emit('category-click', item);
  else if (isTouch.value) selectedItem.value = item;
  else if (props.clickable === 'all') emit('category-click', item);
};

watch(displayedItem, (item) => highlight({ item }));

useResizeObserver(chartContainerRef, renderChart);

watch(
  [() => props.data, chartContainerRef],
  async ([newData, container]) => {
    if (newData.length > 0 && container) {
      await nextTick();
      renderChart();
    }
  },
  { immediate: true, deep: true },
);

// Clear selection when data changes (period changed)
watch(
  () => props.data,
  () => {
    selectedItem.value = null;
    hoveredItem.value = null;
  },
);
</script>
