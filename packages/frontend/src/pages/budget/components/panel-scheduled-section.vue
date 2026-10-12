<script setup lang="ts">
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { CalendarClockIcon, RepeatIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';

import { type PanelContext, amountToneClass } from '../helpers';

defineProps<{ context: PanelContext }>();

const { formatBaseCurrency } = useFormatCurrency();
const { format } = useDateLocale();

const formatDate = ({ date }: { date: string }) => format(parseISO(date), 'd MMM');
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

    <div class="grid gap-2">
      <div v-for="item in context.scheduled.items" :key="`${item.source}-${item.id}-${item.date}`" class="min-w-0">
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
        </div>
      </div>
    </div>
  </div>
</template>
