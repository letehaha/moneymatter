<script setup lang="ts">
import { ChartTooltipHeader, ChartTooltipRow } from '@/components/common/charts/chart-tooltip';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { useFormatCurrency } from '@/composable';
import { useDateLocale } from '@/composable/use-date-locale';
import { cn } from '@/lib/utils';
import { parseISO } from 'date-fns';
import { computed } from 'vue';

import { type PanelContext, formatPeriodLabel, trendBars, trendPaddingStarts } from '../helpers';

const props = defineProps<{ context: PanelContext }>();

const SERIES = [
  { key: 'assigned', swatchClass: 'bg-muted-foreground/25', color: 'var(--muted-foreground)', valueClass: undefined },
  { key: 'spent', swatchClass: 'bg-primary', color: 'var(--primary)', valueClass: undefined },
  {
    key: 'over',
    swatchClass: 'bg-app-expense-color',
    color: 'var(--app-expense-color)',
    valueClass: 'text-app-expense-color',
  },
] as const;

const { formatBaseCurrency } = useFormatCurrency();
const { format, locale } = useDateLocale();

const periods = computed(() => props.context.trends?.periods ?? []);
const trend = computed(() => trendBars({ periods: periods.value, lineIds: props.context.lineIds }));
const current = computed(() => trend.value.bars.at(-1));

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
    title: '',
    bar: undefined,
    isCurrent: false,
  })),
  ...periods.value.map((period, index) => ({
    key: period.periodId,
    label: formatLabel({ startDate: period.startDate }),
    title: formatPeriodLabel({ ...period, locale: locale.value }),
    bar: trend.value.bars[index],
    isCurrent: index === periods.value.length - 1,
  })),
]);
</script>

<template>
  <div class="grid gap-3">
    <div class="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
      <span v-for="item in SERIES" :key="item.key" class="flex items-center gap-1.5">
        <span :class="cn('size-2 rounded-xs', item.swatchClass)" />
        {{ $t(`budgetPlans.panel.trend.${item.key}`) }}
      </span>
    </div>

    <div class="flex h-24 min-w-0 gap-1.5">
      <ResponsiveTooltip
        v-for="slot in slots"
        :key="slot.key"
        variant="chart"
        :delay-duration="100"
        :disabled="!slot.bar"
      >
        <div class="flex h-full min-w-0 flex-1 flex-col gap-1">
          <div class="relative flex-1">
            <div
              v-if="!slot.bar || (!slot.bar.assignedPercent && !slot.bar.spent)"
              class="bg-muted-foreground/25 absolute inset-x-0 bottom-0 h-0.5 rounded-sm"
            />
            <template v-else>
              <div
                class="bg-muted-foreground/25 absolute inset-x-0 bottom-0 rounded-t-sm"
                :style="{ height: `${slot.bar.assignedPercent}%` }"
              />
              <div :class="cn('absolute inset-x-1/4 inset-y-0', !slot.isCurrent && 'opacity-60')">
                <div
                  :class="cn('bg-primary absolute inset-x-0 bottom-0', !slot.bar.over && 'rounded-t-sm')"
                  :style="{ height: `${slot.bar.withinPercent}%` }"
                />
                <div
                  v-if="slot.bar.over"
                  class="bg-app-expense-color absolute inset-x-0 rounded-t-sm"
                  :style="{ bottom: `${slot.bar.withinPercent}%`, height: `${slot.bar.overPercent}%` }"
                />
              </div>
            </template>
          </div>
          <span
            :class="
              cn(
                'w-full truncate text-center text-[10px]',
                slot.isCurrent ? 'text-primary-text' : 'text-muted-foreground',
              )
            "
          >
            {{ slot.label }}
          </span>
        </div>

        <template v-if="slot.bar" #content>
          <ChartTooltipHeader>{{ slot.title }}</ChartTooltipHeader>
          <template v-for="item in SERIES" :key="item.key">
            <ChartTooltipRow
              v-if="item.key !== 'over' || slot.bar.over"
              :color="item.color"
              :label="$t(`budgetPlans.panel.trend.${item.key}`)"
              :value="formatBaseCurrency(slot.bar[item.key])"
              :value-class="item.valueClass"
            />
          </template>
        </template>
      </ResponsiveTooltip>
    </div>

    <div
      v-if="current"
      class="text-muted-foreground flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs tabular-nums"
    >
      <span>
        <i18n-t keypath="budgetPlans.panel.trend.spentOfAssigned" tag="span">
          <template #spent>
            <span class="text-foreground text-sm font-medium">{{ formatBaseCurrency(current.spent) }}</span>
          </template>
          <template #assigned>{{ formatBaseCurrency(current.assigned) }}</template>
        </i18n-t>
        <template v-if="trend.usedPercent !== null"> · {{ Math.round(trend.usedPercent) }}%</template>
      </span>
      <span v-if="trend.averageUsedPercent !== null">
        {{ $t('budgetPlans.panel.trend.averageUsed', { percent: Math.round(trend.averageUsedPercent) }) }}
      </span>
    </div>
  </div>
</template>
