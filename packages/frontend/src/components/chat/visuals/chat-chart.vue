<script setup lang="ts">
import type { ChatChartSpec } from '@bt/shared/types';
import { computed } from 'vue';

import ChatDonutChart from './chat-donut-chart.vue';
import ChatSeriesChart from './chat-series-chart.vue';
import { hasDonutData, hasSeriesData } from './chart-geometry';

const props = defineProps<{ spec: ChatChartSpec }>();

const hasData = computed(() =>
  props.spec.kind === 'donut' ? hasDonutData({ slices: props.spec.slices }) : hasSeriesData({ spec: props.spec }),
);
</script>

<template>
  <figure class="flex min-w-0 flex-col gap-2">
    <figcaption class="text-sm font-medium wrap-anywhere">{{ spec.title }}</figcaption>

    <p v-if="!hasData" data-testid="chart-empty" class="text-muted-foreground text-sm">
      {{ $t('chat.visuals.emptyChart') }}
    </p>
    <ChatDonutChart v-else-if="spec.kind === 'donut'" :spec="spec" />
    <ChatSeriesChart v-else :spec="spec" />
  </figure>
</template>
