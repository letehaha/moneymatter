<template>
  <div class="@container">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <PeriodSelector v-model="period" :payday="payday" />
      <div class="hidden flex-wrap items-center gap-2 @md:flex"><slot /></div>
      <FiltersButton :label="$t('analytics.controls.options')" class="@md:hidden">
        <div class="flex flex-col gap-3 *:w-full! [&_[role=combobox]]:w-full"><slot /></div>
      </FiltersButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Period } from '@/composable/use-period-navigation';

import PeriodSelector from '../subpages/cash-flow/components/period-selector.vue';
import FiltersButton from './filters-button.vue';

// Controls in the slot render inline on wide containers and fold behind an
// Options button on narrow ones.
const period = defineModel<Period>('period', { required: true });
defineProps<{ payday?: number }>();
</script>
