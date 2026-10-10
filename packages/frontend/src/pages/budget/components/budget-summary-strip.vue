<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriod, BudgetPlanPeriodView } from '@bt/shared/types';
import { CircleCheckIcon, InfoIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import { amountToneClass, formatPeriodLabel, isPastPeriod } from '../helpers';
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

const periodLabel = computed(() => formatPeriodLabel({ ...props.view.period, locale: locale.value }));
const previousPeriodLabel = computed(() =>
  props.previousPeriod ? formatPeriodLabel({ ...props.previousPeriod, locale: locale.value }) : undefined,
);
</script>

<template>
  <div v-if="view.pool" class="flex flex-wrap items-center gap-x-4 gap-y-2">
    <div class="min-w-0">
      <div class="text-muted-foreground flex items-center gap-1 text-xs font-medium uppercase">
        {{ $t('budgetPlans.pool.readyToAssign') }}
        <DesktopOnlyTooltip :content="$t('budgetPlans.pool.calc.title')" side="right">
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-5"
            :aria-label="$t('budgetPlans.pool.calc.title')"
            @click="isCalculationOpen = true"
          >
            <InfoIcon class="size-3.5" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
      <p
        :class="
          cn('text-2xl leading-tight font-bold tabular-nums', amountToneClass({ amount: view.pool.readyToAssign }))
        "
      >
        {{ formatBaseCurrency(view.pool.readyToAssign) }}
      </p>
      <p v-if="view.pool.readyToAssign < 0" class="text-app-expense-color text-xs font-medium">
        {{
          $t('budgetPlans.pool.overAssigned', {
            amount: formatBaseCurrency(-view.pool.readyToAssign),
          })
        }}
      </p>
      <p v-else-if="zeroSumNow && view.pool.readyToAssign > 0" class="text-muted-foreground text-xs">
        {{ $t('budgetPlans.pool.zeroSumNag') }}
      </p>
      <p v-else-if="zeroSumNow" class="text-muted-foreground flex items-center gap-1 text-xs">
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
</template>
