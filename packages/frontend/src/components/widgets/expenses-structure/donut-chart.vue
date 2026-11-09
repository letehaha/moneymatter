<template>
  <div ref="chartContainerRef" :class="cn('relative h-55 w-full', props.class)">
    <svg ref="svgRef" class="h-full w-full"></svg>

    <!-- Center label: shows Total by default, category info on hover -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div class="flex flex-col items-center gap-0.5 text-center">
        <template v-if="centerLabel.isHovering">
          <div class="text-muted-foreground text-xs">{{ centerLabel.name }}</div>
          <div class="text-base font-semibold">{{ centerLabel.amount }}</div>
        </template>
        <template v-else>
          <div class="text-muted-foreground text-xs">{{ $t('common.labels.total') }}</div>
          <div class="text-base font-semibold">{{ formatBaseCurrency(totalAmount) }}</div>
        </template>
      </div>
    </div>

    <!-- Touch device overlay: shows navigation button below center label -->
    <div
      v-if="isTouch && selectedCategoryId !== null"
      class="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <div class="pointer-events-auto mt-18 flex flex-col items-center">
        <Button
          size="sm"
          variant="outline"
          class="h-6 gap-1 px-2 text-xs"
          @click="$emit('category-click', { categoryId: selectedCategoryId })"
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
import { nextTick, reactive, ref, watch } from 'vue';

import type { ChartDataItem } from './use-expenses-structure-data';

const props = defineProps<{
  data: ChartDataItem[];
  totalAmount: number;
  class?: string;
}>();

const emit = defineEmits<{
  'category-click': [payload: { categoryId: string }];
}>();

const { formatBaseCurrency } = useFormatCurrency();
const isTouch = useMediaQuery('(pointer: coarse)');

const chartContainerRef = ref<HTMLDivElement | null>(null);
const svgRef = ref<SVGSVGElement | null>(null);
const selectedCategoryId = ref<string | null>(null);

const centerLabel = reactive({
  name: '',
  amount: '',
  isHovering: false,
});

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
    .pie<ChartDataItem>()
    .value((d) => d.amount)
    .sort(null);

  const arc = d3.arc<d3.PieArcDatum<ChartDataItem>>().innerRadius(innerRadius).outerRadius(radius);

  const glowArc = d3
    .arc<d3.PieArcDatum<ChartDataItem>>()
    .innerRadius(radius)
    .outerRadius(radius + glowSize);

  const g = svg.append('g').attr('transform', `translate(${width / 2},${height / 2})`);
  const glowGroup = g.append('g').attr('class', 'glow-group');
  const pieData = pie(props.data);
  const arcs = g.selectAll('.arc').data(pieData).enter().append('g').attr('class', 'arc');

  arcs
    .append('path')
    .attr('d', arc)
    .attr('fill', (d) => d.data.color)
    .attr('stroke', 'var(--card)')
    .attr('stroke-width', 2)
    .style('cursor', 'pointer')
    .style('transition', 'opacity 0.2s ease')
    .on('mouseenter', function (_event, d) {
      if (isTouch.value) return;

      g.selectAll('.arc path').style('opacity', 0.3);
      d3.select(this).style('opacity', 1);

      glowGroup.selectAll('*').remove();
      glowGroup.append('path').attr('d', glowArc(d)).attr('fill', d.data.color).style('opacity', 0.5);

      centerLabel.name = d.data.name;
      centerLabel.amount = formatBaseCurrency(d.data.amount);
      centerLabel.isHovering = true;
    })
    .on('mouseleave', function () {
      if (isTouch.value) return;

      g.selectAll('.arc path').style('opacity', 1);
      glowGroup.selectAll('*').remove();
      centerLabel.isHovering = false;
    })
    .on('click', function (_event, d) {
      if (isTouch.value) {
        selectedCategoryId.value = d.data.categoryId;

        g.selectAll('.arc path').style('opacity', 0.3);
        d3.select(this).style('opacity', 1);

        glowGroup.selectAll('*').remove();
        glowGroup.append('path').attr('d', glowArc(d)).attr('fill', d.data.color).style('opacity', 0.5);

        centerLabel.name = d.data.name;
        centerLabel.amount = formatBaseCurrency(d.data.amount);
        centerLabel.isHovering = true;
      } else {
        emit('category-click', { categoryId: d.data.categoryId });
      }
    });
};

// Watch for touch selection changes to update opacity
watch(selectedCategoryId, (newId) => {
  if (!svgRef.value || !newId) {
    const svg = d3.select(svgRef.value);
    svg.selectAll('.arc path').style('opacity', 1);
    svg.selectAll('.glow-group *').remove();
    if (!newId) {
      centerLabel.isHovering = false;
    }
  }
});

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
    selectedCategoryId.value = null;
    centerLabel.isHovering = false;
  },
);
</script>
