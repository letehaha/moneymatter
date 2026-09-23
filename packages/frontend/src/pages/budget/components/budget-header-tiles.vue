<script setup lang="ts">
import { StatCard } from '@/components/lib/ui/stat-card';
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodView } from '@bt/shared/types';
import { computed } from 'vue';

import { amountToneClass, sumOverspent } from '../helpers';

const props = defineProps<{ view: BudgetPlanPeriodView }>();

const { formatBaseCurrency } = useFormatCurrency();

const overspent = computed(() => sumOverspent({ lines: props.view.lines }));
</script>

<template>
  <div class="@container/tiles">
    <div class="grid grid-cols-2 gap-3 @2xl/tiles:grid-cols-4">
      <StatCard :label="$t('budgetPlans.tiles.assigned')" :value="formatBaseCurrency(view.header.totalAssigned)" />
      <StatCard :label="$t('budgetPlans.tiles.spent')" :value="formatBaseCurrency(-view.header.totalActivity)" />

      <StatCard :label="$t('budgetPlans.tiles.available')" :value="''">
        <p :class="cn('mt-1 text-2xl font-bold tabular-nums', amountToneClass({ amount: view.header.totalAvailable }))">
          {{ formatBaseCurrency(view.header.totalAvailable) }}
        </p>
      </StatCard>

      <StatCard :label="$t('budgetPlans.tiles.overspent')" :value="''">
        <p :class="cn('mt-1 text-2xl font-bold tabular-nums', amountToneClass({ amount: overspent.total }))">
          {{ formatBaseCurrency(overspent.total) }}
        </p>
        <p class="text-muted-foreground mt-1 text-xs">
          {{ $t('budgetPlans.tiles.overspentLines', { count: overspent.lineCount }) }}
        </p>
      </StatCard>
    </div>
  </div>
</template>
