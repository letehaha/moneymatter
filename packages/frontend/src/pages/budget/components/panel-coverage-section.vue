<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { BudgetPlanCoverage, BudgetPlanCoverageState } from '@bt/shared/types';
import { CalendarIcon } from '@lucide/vue';
import { computed } from 'vue';

import { type PanelContext, formatPeriodLabel } from '../helpers';

const STATE_TONES: Record<BudgetPlanCoverageState, { text: string; bar: string }> = {
  prepared: { text: 'text-success-text', bar: 'bg-success-text' },
  left_to_cover: { text: 'text-muted-foreground', bar: 'bg-primary' },
  over_committed: { text: 'text-destructive-text', bar: 'bg-app-expense-color' },
  nothing_tracked: { text: 'text-muted-foreground', bar: 'bg-muted-foreground/40' },
};

const props = defineProps<{ context: PanelContext; coverage: BudgetPlanCoverage }>();

const { formatBaseCurrency } = useFormatCurrency();
const { locale } = useDateLocale();

const periodLabel = computed(() =>
  formatPeriodLabel({
    startDate: props.coverage.startDate,
    endDate: props.coverage.endDate,
    locale: locale.value,
  }),
);

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
