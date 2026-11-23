<script setup lang="ts">
import { Button } from '@/components/lib/ui/button';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import type { BudgetPlanPeriodViewLine, BudgetPlanScheduledItem } from '@bt/shared/types';
import { CalendarClockIcon, ChevronRightIcon, CircleCheckIcon, RepeatIcon, TriangleAlertIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { computed } from 'vue';

import { useSetAssignment } from '../composables/use-set-assignment';
import {
  type PanelContext,
  type ScheduledCoverage,
  amountToneClass,
  buildPoolAssignPayload,
  scheduledItemKey,
} from '../helpers';

const props = defineProps<{
  context: PanelContext;
  /** Set in line details. */
  detail?: { line: BudgetPlanPeriodViewLine; coverage: ScheduledCoverage };
  shortLines: { lineId: string; name: string; short: number; bill: BudgetPlanScheduledItem }[];
}>();
const emit = defineEmits<{ selectLine: [lineId: string] }>();

const { formatBaseCurrency, baseCurrencyDecimals } = useFormatCurrency();
const { format } = useDateLocale();
const { isPending, mutate } = useSetAssignment();

const formatDate = ({ date }: { date: string }) => format(parseISO(date), 'd MMM');

/** `bill` is undefined for items the coverage does not judge: inflows, and every item outside line details. */
const rows = computed(() => {
  const billByKey = new Map(props.detail?.coverage.bills.map((bill) => [scheduledItemKey({ item: bill.item }), bill]));
  return (props.context.scheduled?.items ?? []).map((item) => {
    const key = scheduledItemKey({ item });
    return { item, key, bill: billByKey.get(key) };
  });
});

const assignShort = computed(() => {
  if (!props.detail) return null;
  const { line, coverage } = props.detail;
  const payload = buildPoolAssignPayload({ line, amount: coverage.short, decimals: baseCurrencyDecimals.value });
  return (
    payload && {
      short: coverage.short,
      variables: { planId: props.context.planId, periodId: props.context.period.id, lineId: line.lineId, payload },
    }
  );
});
</script>

<template>
  <p v-if="!context.scheduled?.items.length" class="text-muted-foreground text-sm">
    {{ $t('budgetPlans.panel.nothingScheduled') }}
  </p>

  <div v-else class="grid gap-3 text-sm">
    <div class="flex min-w-0 items-center justify-between gap-2 text-xs">
      <span v-if="context.scheduled.nextDate" class="text-muted-foreground truncate">
        {{ $t('budgetPlans.panel.nextOn', { date: formatDate({ date: context.scheduled.nextDate }) }) }}
      </span>
      <span class="bg-muted shrink-0 rounded-full px-2 py-0.5 font-medium">
        {{ $t('budgetPlans.panel.scheduledCount', { count: context.scheduled.items.length }) }}
      </span>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <div class="border-border bg-background rounded-md border p-2">
        <p class="text-muted-foreground text-[10px] font-medium uppercase">{{ $t('budgetPlans.panel.outflows') }}</p>
        <p class="text-app-expense-color font-semibold tabular-nums">
          {{ formatBaseCurrency(Math.abs(context.scheduled.outflows.total)) }}
        </p>
        <p class="text-muted-foreground text-xs">
          {{ $t('budgetPlans.panel.transactionCount', { count: context.scheduled.outflows.count }) }}
        </p>
      </div>
      <div v-if="context.scheduled.inflows.count > 0" class="border-border bg-background rounded-md border p-2">
        <p class="text-muted-foreground text-[10px] font-medium uppercase">{{ $t('budgetPlans.panel.inflows') }}</p>
        <p class="text-app-income-color font-semibold tabular-nums">
          {{ formatBaseCurrency(context.scheduled.inflows.total) }}
        </p>
        <p class="text-muted-foreground text-xs">
          {{ $t('budgetPlans.panel.transactionCount', { count: context.scheduled.inflows.count }) }}
        </p>
      </div>
    </div>

    <div v-if="shortLines.length" class="grid gap-1">
      <p class="text-muted-foreground text-xs">{{ $t('budgetPlans.panel.notCovered.title') }}</p>
      <Button
        v-for="entry in shortLines"
        :key="entry.lineId"
        variant="ghost"
        class="-mx-2 h-auto min-w-0 justify-start gap-2 px-2 py-1.5 text-left font-normal"
        @click="emit('selectLine', entry.lineId)"
      >
        <TriangleAlertIcon class="text-warning-text size-4 shrink-0" />
        <span class="min-w-0 flex-1">
          <span class="block truncate">{{ entry.name }}</span>
          <span class="text-muted-foreground block truncate text-xs">
            {{ entry.bill.name }} · {{ formatDate({ date: entry.bill.date }) }}
          </span>
        </span>
        <span class="bg-warning/15 text-warning-text shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums">
          {{ formatBaseCurrency(entry.short) }}
        </span>
        <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
      </Button>
    </div>

    <div class="grid gap-2">
      <div v-for="{ item, key, bill } in rows" :key="key" class="min-w-0">
        <div class="flex justify-between gap-3">
          <span class="truncate">{{ item.name }}</span>
          <span :class="cn('shrink-0 tabular-nums', amountToneClass({ amount: item.amount }))">
            {{ formatBaseCurrency(item.amount) }}
          </span>
        </div>
        <div class="text-muted-foreground flex min-w-0 items-center gap-1 text-xs">
          <RepeatIcon v-if="item.source === 'subscription'" class="size-3 shrink-0" />
          <CalendarClockIcon v-else class="size-3 shrink-0" />
          <span class="truncate">{{ formatDate({ date: item.date }) }}</span>
          <span
            v-if="bill?.status === 'short'"
            class="bg-warning/15 text-warning-text ml-auto shrink-0 rounded-full px-2 py-0.5 font-medium tabular-nums"
          >
            {{ $t('budgetPlans.panel.notCovered.pill', { amount: formatBaseCurrency(bill.short) }) }}
          </span>
          <span
            v-else-if="bill?.status === 'covered'"
            class="text-success-text ml-auto flex shrink-0 items-center gap-1 font-medium"
          >
            <CircleCheckIcon class="size-3" />
            {{ $t('budgetPlans.panel.notCovered.covered') }}
          </span>
        </div>
      </div>
    </div>

    <Button
      v-if="assignShort"
      size="sm"
      class="w-full min-w-0"
      :disabled="isPending"
      @click="mutate(assignShort.variables)"
    >
      {{ $t('budgetPlans.panel.notCovered.assign', { amount: formatBaseCurrency(assignShort.short) }) }}
    </Button>
  </div>
</template>
