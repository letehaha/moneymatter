<script lang="ts" setup>
import { computed } from 'vue';

import { buildSparklinePoints, orientTrend } from './category-trend';

const WIDTH = 64;
const HEIGHT = 20;
const PADDING = 2;

const props = defineProps<{
  values: number[];
  netAmount: number;
}>();

const points = computed(() =>
  buildSparklinePoints({
    values: orientTrend({ values: props.values, netAmount: props.netAmount }),
    width: WIDTH,
    height: HEIGHT,
    padding: PADDING,
  }),
);

const polyline = computed(() => points.value.map(({ x, y }) => `${x},${y}`).join(' '));
const lastPoint = computed(() => points.value.at(-1));
</script>

<template>
  <svg
    :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
    class="h-5 w-16 shrink-0"
    aria-hidden="true"
    data-testid="cst-trend-sparkline"
  >
    <polyline
      :points="polyline"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <circle v-if="lastPoint" :cx="lastPoint.x" :cy="lastPoint.y" r="2" fill="currentColor" />
  </svg>
</template>
