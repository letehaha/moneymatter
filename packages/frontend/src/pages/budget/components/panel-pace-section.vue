<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { cn } from '@/lib/utils';
import { computed } from 'vue';

import { type PanelContext, paceCaptionNumbers, paceStateOf, spendingPace } from '../helpers';

const props = defineProps<{ context: PanelContext }>();

const { formatBaseCurrency } = useFormatCurrency();

const pace = computed(() => spendingPace({ ...props.context.figures, ...props.context.period }));
const state = computed(() =>
  paceStateOf({
    spentPercent: pace.value.spentPercent,
    expectedPercent: props.context.pace?.expectedPercent ?? null,
    isOver: pace.value.spentPercent > 100,
  }),
);

const SPENT_BAR_CLASS = { over: 'bg-app-expense-color', ahead: 'bg-warning-text', ok: 'bg-success-text' } as const;

const bars = computed(() => [
  {
    labelKey: 'budgetPlans.panel.spent',
    percent: pace.value.spentPercent,
    class: SPENT_BAR_CLASS[state.value ?? 'ok'],
  },
  props.context.pace?.basisLabel === 'usual'
    ? {
        labelKey: 'budgetPlans.panel.usuallyByToday',
        percent: props.context.pace.expectedPercent,
        class: 'bg-muted-foreground/40',
      }
    : { labelKey: 'budgetPlans.panel.elapsed', percent: pace.value.elapsedPercent, class: 'bg-muted-foreground/40' },
]);

const slowDownPerDay = computed(() => {
  if (state.value !== 'ahead' || !props.context.pace) return null;
  return paceCaptionNumbers({
    spent: pace.value.spent,
    funded: pace.value.total,
    available: props.context.figures.available,
    expectedPercent: props.context.pace.expectedPercent,
    daysLeft: pace.value.daysLeft,
  }).perDay;
});
</script>

<template>
  <div class="grid gap-3 text-sm">
    <div v-for="bar in bars" :key="bar.labelKey" class="grid gap-1">
      <div class="flex min-w-0 justify-between gap-3">
        <span>{{ $t(bar.labelKey) }}</span>
        <span class="tabular-nums">{{ Math.round(bar.percent) }}%</span>
      </div>
      <div class="bg-muted h-1.5 overflow-hidden rounded-full">
        <div :class="cn('h-full rounded-full', bar.class)" :style="{ width: `${Math.min(100, bar.percent)}%` }" />
      </div>
    </div>

    <p v-if="slowDownPerDay !== null" class="text-warning-text tabular-nums">
      {{ $t('budgetPlans.panel.slowDown', { perDay: formatBaseCurrency(slowDownPerDay) }) }}
    </p>

    <div class="text-muted-foreground flex min-w-0 justify-between gap-3 text-xs">
      <span class="truncate tabular-nums">
        {{
          $t('budgetPlans.panel.spentOfTotal', {
            spent: formatBaseCurrency(pace.spent),
            total: formatBaseCurrency(pace.total),
          })
        }}
      </span>
      <span class="shrink-0">{{ $t('budgetPlans.panel.daysLeft', { n: pace.daysLeft }) }}</span>
    </div>
  </div>
</template>
