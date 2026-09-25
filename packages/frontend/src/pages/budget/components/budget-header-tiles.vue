<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { StatCard } from '@/components/lib/ui/stat-card';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriod, BudgetPlanPeriodView } from '@bt/shared/types';
import { CircleCheckIcon, InfoIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import { amountToneClass, formatPeriodLabel, isPastPeriod, sumOverspent } from '../helpers';
import PoolAssignPopover from './pool-assign-popover.vue';
import PoolCalculationDialog from './pool-calculation-dialog.vue';
import PoolFixPopover from './pool-fix-popover.vue';

const props = defineProps<{
  planId: string;
  view: BudgetPlanPeriodView;
  previousPeriod?: BudgetPlanPeriod;
  zeroSum: boolean;
}>();

const { formatBaseCurrency } = useFormatCurrency();
const { locale } = useDateLocale();

const isCalculationOpen = ref(false);

const zeroSumNow = computed(() => props.zeroSum && props.view.period.isCurrent);
// A take-back in a past period rewrites history and leaves the current shortfall as it is.
const canFixPool = computed(
  () => (props.view.pool?.readyToAssign ?? 0) < 0 && !isPastPeriod({ period: props.view.period }),
);
const overspent = computed(() => sumOverspent({ lines: props.view.lines }));

const periodLabel = computed(() => formatPeriodLabel({ ...props.view.period, locale: locale.value }));
const previousPeriodLabel = computed(() =>
  props.previousPeriod ? formatPeriodLabel({ ...props.previousPeriod, locale: locale.value }) : undefined,
);
</script>

<template>
  <div class="@container/tiles grid gap-3">
    <div
      v-if="view.pool"
      class="bg-muted/40 border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
    >
      <div class="min-w-0">
        <p :class="cn('text-3xl font-bold tabular-nums', amountToneClass({ amount: view.pool.readyToAssign }))">
          {{ formatBaseCurrency(view.pool.readyToAssign) }}
        </p>
        <div class="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase">
          {{ $t('budgetPlans.pool.readyToAssign') }}
          <DesktopOnlyTooltip :content="$t('budgetPlans.pool.calc.title')" side="right">
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-6"
              :aria-label="$t('budgetPlans.pool.calc.title')"
              @click="isCalculationOpen = true"
            >
              <InfoIcon class="size-4" />
            </Button>
          </DesktopOnlyTooltip>
        </div>
        <p v-if="view.pool.readyToAssign < 0" class="text-app-expense-color mt-1 text-xs font-medium">
          {{ $t('budgetPlans.pool.overAssigned', { amount: formatBaseCurrency(-view.pool.readyToAssign) }) }}
        </p>
        <p v-else-if="zeroSumNow && view.pool.readyToAssign > 0" class="text-muted-foreground mt-1 text-xs">
          {{ $t('budgetPlans.pool.zeroSumNag') }}
        </p>
        <p v-else-if="zeroSumNow" class="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
          <CircleCheckIcon class="text-success-text size-3.5" />
          {{ $t('budgetPlans.pool.allAssigned') }}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <PoolFixPopover :plan-id="planId" :view="view" :visible="canFixPool" />
        <PoolAssignPopover :plan-id="planId" :view="view" :prominent="zeroSumNow && view.pool.readyToAssign > 0" />
      </div>

      <PoolCalculationDialog
        v-model:open="isCalculationOpen"
        :pool="view.pool"
        :period-label="periodLabel"
        :previous-period-label="previousPeriodLabel"
      />
    </div>

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
