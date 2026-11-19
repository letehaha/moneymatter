<template>
  <div class="border-border inline-flex h-10 rounded-md border">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      :class="[
        'flex h-full items-center justify-center px-3 text-sm transition-colors',
        'first:rounded-l-md last:rounded-r-md',
        'border-border border-r last:border-r-0',
        modelValue === option.value ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-hover',
      ]"
      :title="option.label"
      @click="emit('update:modelValue', option.value)"
    >
      <component :is="option.icon" class="size-4" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { ChartBarStackedIcon, ChartColumnIcon, FlipVertical2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

export type ChartType = 'stacked' | 'mirrored' | 'grouped';

defineProps<{
  modelValue: ChartType;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: ChartType];
}>();

const { t } = useI18n();

const options = computed(() => [
  {
    value: 'stacked' as const,
    label: t('analytics.cashFlow.chartTypes.stacked'),
    icon: ChartBarStackedIcon,
  },
  {
    value: 'mirrored' as const,
    label: t('analytics.cashFlow.chartTypes.mirrored'),
    icon: FlipVertical2Icon,
  },
  {
    value: 'grouped' as const,
    label: t('analytics.cashFlow.chartTypes.grouped'),
    icon: ChartColumnIcon,
  },
]);
</script>
