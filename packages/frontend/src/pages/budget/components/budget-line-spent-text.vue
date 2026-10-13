<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { computed } from 'vue';

import { type LineAmounts, spentSummaryOf } from '../helpers';

const props = defineProps<{ line: LineAmounts }>();

const { formatShortBaseCurrency } = useFormatCurrency();

const summary = computed(() => spentSummaryOf({ line: props.line }));
</script>

<template>
  <span class="text-muted-foreground tabular-nums">
    <template v-if="summary.kind === 'unfunded'">{{ $t('budgetPlans.grid.notFunded') }}</template>
    <template v-else>
      <span
        :class="
          cn(
            summary.kind === 'overspent' && 'text-app-expense-color font-semibold',
            summary.kind === 'used' && summary.used > 0 && 'text-foreground font-semibold',
          )
        "
      >
        {{
          summary.kind === 'overspent'
            ? $t('budgetPlans.grid.overBy', { amount: formatShortBaseCurrency({ amount: summary.overBy }) })
            : $t('budgetPlans.grid.percentUsed', { percent: summary.percent })
        }}
      </span>
      ·
      {{
        $t('budgetPlans.panel.spentOfTotal', {
          spent: formatShortBaseCurrency({ amount: summary.used }),
          total: formatShortBaseCurrency({ amount: summary.funded }),
        })
      }}
    </template>
  </span>
</template>
