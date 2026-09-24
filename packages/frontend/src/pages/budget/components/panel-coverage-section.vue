<script setup lang="ts">
import { loadBudgetPlanPeriods } from '@/api/budget-plans';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { BudgetPlanCoverage, BudgetPlanCoverageState } from '@bt/shared/types';
import { CalendarIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { format, parseISO } from 'date-fns';
import { computed } from 'vue';

import { type PanelContext, formatPeriodLabel } from '../helpers';

const STATE_TONES: Record<BudgetPlanCoverageState, { text: string; bar: string }> = {
  prepared: { text: 'text-success-text', bar: 'bg-success' },
  left_to_cover: { text: 'text-muted-foreground', bar: 'bg-primary' },
  over_committed: { text: 'text-destructive-text', bar: 'bg-app-expense-color' },
  nothing_tracked: { text: 'text-muted-foreground', bar: 'bg-muted-foreground/40' },
};

const props = defineProps<{ context: PanelContext; coverage: BudgetPlanCoverage }>();

const { formatBaseCurrency } = useFormatCurrency();
const { locale } = useDateLocale();

const { data: periods } = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.budgetPlanPeriods, props.context.planId]),
  queryFn: () => loadBudgetPlanPeriods({ planId: props.context.planId }),
});

const periodLabel = computed(() => {
  const next = periods.value?.find((period) => period.id === props.coverage.periodId);
  return next
    ? formatPeriodLabel({ ...next, locale: locale.value })
    : format(parseISO(props.coverage.startDate), 'd MMM yyyy', { locale: locale.value });
});

const tone = computed(() => STATE_TONES[props.coverage.state]);
</script>

<template>
  <div class="grid gap-3 text-sm">
    <div class="flex min-w-0 items-start gap-2">
      <CalendarIcon class="text-primary-text mt-0.5 size-4 shrink-0" />
      <div class="min-w-0">
        <p class="truncate font-medium">{{ periodLabel }}</p>
        <p class="text-muted-foreground text-xs">{{ $t('budgetPlans.goals.coverage.subtitle') }}</p>
      </div>
    </div>

    <div class="grid gap-1.5">
      <p class="flex items-baseline gap-1.5">
        <span class="text-2xl font-bold tabular-nums">{{ coverage.percent }}%</span>
        <span class="text-muted-foreground text-xs">{{ $t('budgetPlans.goals.coverage.prepared') }}</span>
      </p>
      <div class="bg-muted h-1.5 overflow-hidden rounded-full">
        <div :class="cn('h-full rounded-full', tone.bar)" :style="{ width: `${coverage.percent}%` }" />
      </div>
    </div>

    <div class="grid gap-0.5 text-xs">
      <p class="tabular-nums">
        {{
          $t('budgetPlans.goals.coverage.linedUpOf', {
            linedUp: formatBaseCurrency(coverage.linedUp),
            target: formatBaseCurrency(coverage.target),
          })
        }}
      </p>
      <p :class="tone.text">
        {{
          $t(`budgetPlans.goals.coverage.state.${coverage.state}`, {
            amount: formatBaseCurrency(coverage.left),
            period: periodLabel,
          })
        }}
      </p>
    </div>
  </div>
</template>
