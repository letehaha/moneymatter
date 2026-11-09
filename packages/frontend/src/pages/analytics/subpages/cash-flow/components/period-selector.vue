<template>
  <div
    :class="
      cn(
        'flex items-center justify-center gap-0.5',
        fluid && 'min-w-0',
        variant === 'solid' && 'border-input bg-input-background h-9 rounded-md border px-0.5',
      )
    "
  >
    <Button size="icon-sm" variant="ghost" class="shrink-0" @click="selectPrevPeriod">
      <ChevronLeft :size="16" />
    </Button>

    <DateSelector v-model="period" :presets="quickPresets" :earliest-date="earliestDate">
      <template #trigger="{ triggerText }">
        <Button
          variant="ghost"
          size="sm"
          :class="cn('font-medium', fluid ? 'min-w-0 flex-1' : 'min-w-55', variant === 'solid' && 'h-8')"
        >
          <CalendarIcon class="mr-1.5 size-3.5 shrink-0" />
          <span class="truncate">{{ triggerText }}</span>
        </Button>
      </template>
    </DateSelector>

    <Button size="icon-sm" variant="ghost" class="shrink-0" :disabled="isNextDisabled" @click="selectNextPeriod">
      <ChevronRight :size="16" />
    </Button>
  </div>
</template>

<script lang="ts" setup>
import Button from '@/components/lib/ui/button/Button.vue';
import { DateSelector, type DateSelectorPreset } from '@/components/lib/ui/date-selector';
import { cn } from '@/lib/utils';
import { useEarliestTransactionDate } from '@/composable/data-queries/earliest-transaction-date';
import { type Period, getPayPeriod, usePeriodNavigation } from '@/composable/use-period-navigation';
import { endOfYear, isAfter, startOfYear, subMonths, subYears } from 'date-fns';
import { CalendarIcon, ChevronLeft, ChevronRight } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    modelValue: Period;
    variant?: 'ghost' | 'solid';
    payday?: number;
    /** Shrinks with its container and truncates the label instead of holding a fixed minimum width. */
    fluid?: boolean;
  }>(),
  { variant: 'ghost', payday: 1 },
);

const emit = defineEmits<{
  'update:modelValue': [value: Period];
}>();

const period = computed({
  get: () => props.modelValue,
  set: (value: Period) => emit('update:modelValue', value),
});

const { prevPeriod, nextPeriod } = usePeriodNavigation({
  period: () => props.modelValue,
  payday: () => props.payday,
});

const { earliestDate } = useEarliestTransactionDate();

const isNextDisabled = computed(() => isAfter(nextPeriod.value.from, new Date()));

function selectPrevPeriod() {
  period.value = prevPeriod.value;
}

function selectNextPeriod() {
  period.value = nextPeriod.value;
}

const lastPayPeriods = (count: number) => (): Period => {
  const current = getPayPeriod({ date: new Date(), payday: props.payday });
  return { from: subMonths(current.from, count - 1), to: current.to };
};

const quickPresets = computed<DateSelectorPreset[]>(() => [
  ...(props.payday !== 1
    ? [{ label: t('analytics.cashFlow.periods.currentPayPeriod'), getValue: lastPayPeriods(1) }]
    : []),
  {
    label: t('analytics.cashFlow.periods.last3Months'),
    getValue: lastPayPeriods(3),
  },
  {
    label: t('analytics.cashFlow.periods.last6Months'),
    getValue: lastPayPeriods(6),
  },
  {
    label: t('analytics.cashFlow.periods.last12Months'),
    getValue: lastPayPeriods(12),
  },
  {
    label: t('analytics.cashFlow.periods.thisYear'),
    getValue: () => ({
      from: startOfYear(new Date()),
      to: new Date(),
    }),
  },
  {
    label: t('analytics.cashFlow.periods.previousYear'),
    getValue: () => {
      const prevYear = subYears(new Date(), 1);
      return {
        from: startOfYear(prevYear),
        to: endOfYear(prevYear),
      };
    },
  },
  {
    label: t('analytics.cashFlow.periods.allTime'),
    // Fallback start covers the case where the earliest-date query hasn't resolved:
    // far enough back to include any realistic personal-finance history.
    getValue: () => ({
      from: earliestDate.value ?? new Date(2000, 0, 1),
      to: new Date(),
    }),
  },
]);
</script>
