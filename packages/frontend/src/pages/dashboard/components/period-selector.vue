<template>
  <div class="flex items-center justify-center gap-0.5">
    <Button size="icon-sm" variant="ghost" @click="selectPrevPeriod">
      <ChevronLeft :size="16" />
    </Button>

    <DateSelector
      v-model="period"
      :presets="quickPresets"
      :earliest-date="earliestDate"
      popover-class-name="md:min-w-[600px]"
    >
      <template #trigger="{ triggerText }">
        <Button variant="ghost" size="sm" class="min-w-48 font-medium">
          <CalendarIcon class="size-3.5" />
          {{ triggerText }}
        </Button>
      </template>
    </DateSelector>

    <Button size="icon-sm" variant="ghost" :disabled="isNextDisabled" @click="selectNextPeriod">
      <ChevronRight :size="16" />
    </Button>
  </div>
</template>

<script lang="ts" setup>
import Button from '@/components/lib/ui/button/Button.vue';
import { DateSelector, type DateSelectorPreset } from '@/components/lib/ui/date-selector';
import { useEarliestTransactionDate } from '@/composable/data-queries/earliest-transaction-date';
import { getPayPeriod, usePeriodNavigation } from '@/composable/use-period-navigation';
import { format as dateFnsFormat, endOfYear, isBefore, isSameDay, startOfYear, subMonths, subYears } from 'date-fns';
import { CalendarIcon, ChevronLeft, ChevronRight } from '@lucide/vue';
import { computed, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { type Period } from '../types';

const { t } = useI18n();

const props = defineProps<{
  modelValue: Period;
  payday: number;
}>();

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

const getCurrentPayPeriod = () => getPayPeriod({ date: new Date(), payday: props.payday });

const lastPayPeriods = (count: number) => (): Period => {
  const current = getCurrentPayPeriod();
  return { from: subMonths(current.from, count - 1), to: current.to };
};

const { earliestDate } = useEarliestTransactionDate();

const isNextDisabled = computed(() => !isBefore(props.modelValue.to, getCurrentPayPeriod().from));

function selectPrevPeriod() {
  period.value = prevPeriod.value;
}

function selectNextPeriod() {
  period.value = nextPeriod.value;
}

function isCurrentPayPeriod(p: Period): boolean {
  const current = getCurrentPayPeriod();
  return isSameDay(p.from, current.from) && isSameDay(p.to, current.to);
}

// Sync period to URL using history.replaceState
watch(
  () => props.modelValue,
  (p) => {
    const url = new URL(window.location.href);

    if (isCurrentPayPeriod(p)) {
      url.search = '';
    } else {
      url.searchParams.set('from', dateFnsFormat(p.from, 'yyyy-MM-dd'));
      url.searchParams.set('to', dateFnsFormat(p.to, 'yyyy-MM-dd'));
    }

    window.history.replaceState(history.state, '', url);
  },
  { deep: true },
);

const quickPresets = computed<DateSelectorPreset[]>(() => [
  {
    label: t('dashboard.periodSelector.presets.currentMonth'),
    getValue: getCurrentPayPeriod,
  },
  {
    label: t('dashboard.periodSelector.presets.last3Months'),
    getValue: lastPayPeriods(3),
  },
  {
    label: t('dashboard.periodSelector.presets.last6Months'),
    getValue: lastPayPeriods(6),
  },
  {
    label: t('dashboard.periodSelector.presets.lastYear'),
    getValue: lastPayPeriods(12),
  },
  {
    label: t('dashboard.periodSelector.presets.thisYear'),
    getValue: () => ({
      from: startOfYear(new Date()),
      to: new Date(),
    }),
  },
  {
    label: t('dashboard.periodSelector.presets.previousYear'),
    getValue: () => {
      const prevYear = subYears(new Date(), 1);
      return {
        from: startOfYear(prevYear),
        to: endOfYear(prevYear),
      };
    },
  },
]);
</script>
