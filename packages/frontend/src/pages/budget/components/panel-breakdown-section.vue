<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { computed } from 'vue';

import { type PanelContext, availablePillClass } from '../helpers';

const props = defineProps<{ context: PanelContext }>();

const { formatBaseCurrency } = useFormatCurrency();

const rows = computed(() => [
  { operator: '→', labelKey: 'budgetPlans.panel.carriedOver', amount: props.context.figures.carriedIn },
  { operator: '+', labelKey: 'budgetPlans.grid.assigned', amount: props.context.figures.assigned },
  { operator: '+', labelKey: 'budgetPlans.grid.activity', amount: props.context.figures.activity },
]);
</script>

<template>
  <div class="grid gap-2 text-sm">
    <div v-for="row in rows" :key="row.labelKey" class="flex min-w-0 items-center justify-between gap-3">
      <span class="flex min-w-0 items-center gap-2">
        <span class="text-muted-foreground w-3 text-xs">{{ row.operator }}</span>
        <span class="truncate">{{ $t(row.labelKey) }}</span>
      </span>
      <span class="tabular-nums">{{ formatBaseCurrency(row.amount) }}</span>
    </div>

    <div class="border-border flex min-w-0 items-center justify-between gap-3 border-t pt-2 font-medium">
      <span class="flex min-w-0 items-center gap-2">
        <span class="text-muted-foreground w-3 text-xs">=</span>
        <span class="truncate">{{ $t('budgetPlans.grid.available') }}</span>
      </span>
      <span :class="availablePillClass({ amount: context.figures.available })">
        {{ formatBaseCurrency(context.figures.available) }}
      </span>
    </div>
  </div>
</template>
