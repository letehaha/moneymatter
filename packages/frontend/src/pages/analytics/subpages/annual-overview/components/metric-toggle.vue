<template>
  <div class="inline-flex gap-1.5">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="[
        'flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium transition-all',
        modelValue === option.value ? option.activeClass : option.inactiveClass,
      ]"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts">
import type { CumulativeMetric } from '@bt/shared/types';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

export type MetricType = CumulativeMetric;

defineProps<{
  modelValue: MetricType;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: MetricType];
}>();

const { t } = useI18n();

const options = computed(() => [
  {
    value: 'expenses' as const,
    label: t('analytics.trends.metrics.expenses'),
    activeClass: 'bg-red-500/15 text-red-600 dark:text-red-400 ring-1 ring-red-500/30',
    inactiveClass: 'text-muted-foreground hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400',
  },
  {
    value: 'income' as const,
    label: t('analytics.trends.metrics.income'),
    activeClass: 'bg-green-500/15 text-green-600 dark:text-green-400 ring-1 ring-green-500/30',
    inactiveClass: 'text-muted-foreground hover:bg-green-500/10 hover:text-green-600 dark:hover:text-green-400',
  },
  {
    value: 'savings' as const,
    label: t('analytics.trends.metrics.savings'),
    activeClass: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/30',
    inactiveClass: 'text-muted-foreground hover:bg-violet-500/10 hover:text-violet-600 dark:hover:text-violet-400',
  },
]);
</script>
