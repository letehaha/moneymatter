<script setup lang="ts">
import { computed } from 'vue';

import { utilizationClasses } from './utilization-classes';

const props = defineProps<{
  utilizationRate: number;
}>();

const classes = computed(() => utilizationClasses({ rate: props.utilizationRate }));

const clampedRate = computed(() => Math.min(props.utilizationRate, 100));
</script>

<template>
  <div class="mt-3">
    <div class="mb-1 flex items-center justify-between text-xs">
      <span class="text-muted-foreground">{{ $t('budgets.list.used') }}</span>
      <span :class="['font-medium tabular-nums', classes.text]"> {{ Math.round(utilizationRate) }}% </span>
    </div>
    <div class="bg-muted h-1.5 overflow-hidden rounded-full">
      <div
        class="h-full rounded-full transition-all duration-300"
        :class="classes.bg"
        :style="{ width: `${clampedRate}%` }"
      />
    </div>
  </div>
</template>
