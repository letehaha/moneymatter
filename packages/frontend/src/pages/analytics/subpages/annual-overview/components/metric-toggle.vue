<template>
  <PillTabs
    :items="items"
    :model-value="modelValue"
    @update:model-value="(value) => emit('update:modelValue', value as MetricType)"
  />
</template>

<script setup lang="ts">
import { type MetricType } from '@/common/utils/analytics-metric';
import { type PillTabItem, PillTabs } from '@/components/lib/ui/pill-tabs';
import { ArrowDownLeftIcon, ArrowUpRightIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { METRIC_LABEL_KEYS } from '../metric-labels';

defineProps<{
  modelValue: MetricType;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: MetricType];
}>();

const { t } = useI18n();

const items = computed<PillTabItem[]>(() => [
  {
    value: 'expenses',
    label: t(METRIC_LABEL_KEYS.expenses),
    icon: ArrowUpRightIcon,
    iconClass: 'text-app-expense-color @max-lg/controls:mr-0',
    labelClass: '@max-lg/controls:sr-only',
  },
  {
    value: 'income',
    label: t(METRIC_LABEL_KEYS.income),
    icon: ArrowDownLeftIcon,
    iconClass: 'text-app-income-color @max-lg/controls:mr-0',
    labelClass: '@max-lg/controls:sr-only',
  },
]);
</script>
