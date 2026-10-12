<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { ArrowDownRightIcon, ArrowUpRightIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed } from 'vue';

import { type PanelContext, type TrendKind, trendPaddingStarts, trendSummary, trendValues } from '../helpers';

const props = defineProps<{ context: PanelContext; kind: TrendKind }>();

const BAR_CLASSES: Record<TrendKind, { current: string; past: string }> = {
  budgeting: { current: 'bg-primary', past: 'bg-muted-foreground/30' },
  spending: { current: 'bg-app-expense-color', past: 'bg-app-expense-color/30' },
};

const { formatBaseCurrency } = useFormatCurrency();
const { format } = useDateLocale();

const periods = computed(() => props.context.trends?.periods ?? []);
const summary = computed(() =>
  trendSummary({ values: trendValues({ periods: periods.value, lineIds: props.context.lineIds, kind: props.kind }) }),
);

const formatLabel = ({ startDate }: { startDate: string }) =>
  format(parseISO(startDate), props.context.cadence === 'months' ? 'MMM' : 'd MMM');

const slots = computed(() => [
  ...trendPaddingStarts({
    oldest: periods.value[0],
    cadence: props.context.cadence,
    periodCount: periods.value.length,
  }).map((startDate, index) => ({
    key: `pad-${index}`,
    label: startDate ? formatLabel({ startDate }) : '',
    height: null,
    isCurrent: false,
  })),
  ...periods.value.map((period, index) => ({
    key: period.periodId,
    label: formatLabel({ startDate: period.startDate }),
    height: summary.value.heights[index] ?? 0,
    isCurrent: index === periods.value.length - 1,
  })),
]);

const isGood = computed(() => {
  const change = summary.value.changePercent ?? 0;
  return props.kind === 'budgeting' ? change > 0 : change < 0;
});
</script>

<template>
  <div class="grid gap-3">
    <div class="flex h-20 min-w-0 items-end gap-1.5">
      <div v-for="bar in slots" :key="bar.key" class="flex h-full min-w-0 flex-1 flex-col items-center gap-1">
        <div class="flex w-full flex-1 items-end">
          <div v-if="bar.height === 0" class="bg-muted-foreground/30 h-0.5 w-full rounded-sm" />
          <div
            v-else-if="bar.height !== null"
            :class="cn('w-full rounded-sm', BAR_CLASSES[kind][bar.isCurrent ? 'current' : 'past'])"
            :style="{ height: `${bar.height}%` }"
          />
        </div>
        <span
          :class="
            cn('w-full truncate text-center text-[10px]', bar.isCurrent ? 'text-primary-text' : 'text-muted-foreground')
          "
        >
          {{ bar.label }}
        </span>
      </div>
    </div>

    <div class="flex min-w-0 items-center justify-between gap-3 text-xs">
      <span class="flex min-w-0 items-center gap-2">
        <span class="text-sm font-medium tabular-nums">{{ formatBaseCurrency(summary.current) }}</span>
        <span
          v-if="summary.changePercent !== null"
          :class="
            cn(
              'flex items-center tabular-nums',
              summary.changePercent === 0 && 'text-muted-foreground',
              summary.changePercent !== 0 && isGood && 'text-app-income-color',
              summary.changePercent !== 0 && !isGood && 'text-app-expense-color',
            )
          "
        >
          <ArrowUpRightIcon v-if="summary.changePercent >= 0" class="size-3.5" />
          <ArrowDownRightIcon v-else class="size-3.5" />
          {{ Math.round(Math.abs(summary.changePercent)) }}%
        </span>
      </span>
      <span v-if="summary.average !== null" class="text-muted-foreground truncate">
        {{
          $t('budgetPlans.panel.periodAvg', {
            n: summary.averageCount,
            amount: formatBaseCurrency(summary.average),
          })
        }}
      </span>
    </div>
  </div>
</template>
