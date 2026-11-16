<script setup lang="ts">
import Button from '@/components/lib/ui/button/Button.vue';
import { DateSelector, type DateSelectorPreset } from '@/components/lib/ui/date-selector';
import { useDateLocale } from '@/composable/use-date-locale';
import { type Period, usePeriodNavigation } from '@/composable/use-period-navigation';
import { addDays, addMonths, addYears, differenceInYears, endOfMonth, startOfDay } from 'date-fns';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();
const { format } = useDateLocale();

const props = defineProps<{
  modelValue: Period;
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
});

const MIN_ALL_TIME_YEARS = 5;

const isAllTime = computed(() => differenceInYears(props.modelValue.to, props.modelValue.from) >= MIN_ALL_TIME_YEARS);

const triggerLabel = computed(() => {
  if (isAllTime.value) return t('planned.subscriptions.periodFilter.all');

  const { from, to } = props.modelValue;

  if (from.getFullYear() === to.getFullYear()) {
    return `${format(from, 'dd MMM')} – ${format(to, 'dd MMM yyyy')}`;
  }

  return `${format(from, 'dd MMM yyyy')} – ${format(to, 'dd MMM yyyy')}`;
});

function selectPrevPeriod() {
  period.value = prevPeriod.value;
}

function selectNextPeriod() {
  period.value = nextPeriod.value;
}

function resetToAllTime() {
  const today = startOfDay(new Date());
  period.value = { from: today, to: endOfMonth(addYears(today, 10)) };
}

const quickPresets = computed<DateSelectorPreset[]>(() => {
  const today = startOfDay(new Date());

  return [
    {
      label: t('planned.subscriptions.periodFilter.next7Days'),
      getValue: () => ({ from: today, to: addDays(today, 7) }),
    },
    {
      label: t('planned.subscriptions.periodFilter.next30Days'),
      getValue: () => ({ from: today, to: addDays(today, 30) }),
    },
    {
      label: t('planned.subscriptions.periodFilter.next3Months'),
      getValue: () => ({ from: today, to: addMonths(today, 3) }),
    },
    {
      label: t('planned.subscriptions.periodFilter.next6Months'),
      getValue: () => ({ from: today, to: addMonths(today, 6) }),
    },
    {
      label: t('planned.subscriptions.periodFilter.nextYear'),
      getValue: () => ({ from: today, to: addYears(today, 1) }),
    },
    {
      label: t('planned.subscriptions.periodFilter.all'),
      getValue: () => ({ from: today, to: endOfMonth(addYears(today, 10)) }),
    },
  ];
});
</script>

<template>
  <div class="flex items-center gap-0.5">
    <Button size="icon-sm" variant="ghost" @click="selectPrevPeriod">
      <ChevronLeftIcon :size="16" />
    </Button>

    <DateSelector v-model="period" :presets="quickPresets">
      <template #trigger>
        <Button variant="ghost" size="sm" class="min-w-40 font-medium">
          <CalendarIcon class="size-3.5" />
          {{ triggerLabel }}
        </Button>
      </template>
    </DateSelector>

    <Button size="icon-sm" variant="ghost" @click="selectNextPeriod">
      <ChevronRightIcon :size="16" />
    </Button>

    <Button v-if="!isAllTime" size="icon-sm" variant="ghost" class="text-muted-foreground" @click="resetToAllTime">
      <XIcon :size="14" />
    </Button>
  </div>
</template>
