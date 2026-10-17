<script setup lang="ts">
import { cn } from '@/lib/utils';
import { computed, useAttrs } from 'vue';

import { utilizationClasses } from '../utilization-classes';

const OVERFLOW_BAR_WIDTH = 96;

defineOptions({ inheritAttrs: false });

const props = defineProps<{ rate: number }>();
const attrs = useAttrs();

const tone = computed(() => utilizationClasses({ rate: props.rate }));
</script>

<template>
  <div :class="cn('bg-foreground/10 flex h-1.5 gap-0.5 overflow-hidden rounded-full', attrs.class as string)">
    <template v-if="rate > 100">
      <span class="bg-app-expense-color/40 block h-full rounded-full" :style="{ width: `${OVERFLOW_BAR_WIDTH}%` }" />
      <span class="bg-app-expense-color block h-full flex-1 rounded-full" />
    </template>
    <span v-else :class="cn('block h-full rounded-full', tone.bg)" :style="{ width: `${Math.max(0, rate)}%` }" />
  </div>
</template>
