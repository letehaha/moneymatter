<script setup lang="ts">
import { cn } from '@/lib/utils';
import { computed, useAttrs } from 'vue';

defineOptions({ inheritAttrs: false });

const props = defineProps<{ percent: number; barClass: string }>();
const attrs = useAttrs();

const width = computed(() => Math.min(100, Math.max(0, props.percent)));
</script>

<template>
  <div
    v-bind="{ ...attrs, class: undefined }"
    role="progressbar"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="width"
    :class="cn('bg-foreground/10 h-1.5 overflow-hidden rounded-full', attrs.class as string)"
  >
    <span :class="cn('block h-full rounded-full', barClass)" :style="{ width: `${width}%` }" />
  </div>
</template>
