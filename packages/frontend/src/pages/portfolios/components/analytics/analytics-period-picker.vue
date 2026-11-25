<script setup lang="ts">
import { PillTabs } from '@/components/lib/ui/pill-tabs';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useKeyModifier } from '@vueuse/core';
import { computed } from 'vue';

import { usePeriodLabels } from '../portfolio-hero/use-period-labels';
import { ANALYTICS_PERIODS, type AnalyticsPeriod } from './analytics-derivations';

defineProps<{ modelValue: AnalyticsPeriod }>();

const emit = defineEmits<{ select: [selection: { period: AnalyticsPeriod; applyToAll: boolean }] }>();

const isShiftPressed = useKeyModifier('Shift');
const periodLabels = usePeriodLabels();
const items = computed(() => ANALYTICS_PERIODS.map((value) => ({ value, label: periodLabels.value[value] })));

const select = (value: string) =>
  emit('select', { period: value as AnalyticsPeriod, applyToAll: Boolean(isShiftPressed.value) });
</script>

<template>
  <DesktopOnlyTooltip :content="$t('portfolioDetail.analytics.periodShiftHint')">
    <PillTabs :model-value="modelValue" :items="items" size="sm" @update:model-value="select" />
  </DesktopOnlyTooltip>
</template>
