<template>
  <DateSelector :model-value="currentPeriod" :presets="presets" @update:model-value="handlePeriodUpdate">
    <template #trigger="{ triggerText }">
      <Button
        variant="field"
        :size="size"
        :class="['w-full justify-start text-left', !hasDates && 'text-muted-foreground']"
      >
        <CalendarIcon class="size-4 shrink-0" />
        <span class="min-w-0 flex-1 truncate">
          {{ hasDates ? triggerText : $t('transactions.filters.dateRange.placeholder') }}
        </span>
        <!-- Span, not Button: the trigger itself is a button and buttons can't nest. -->
        <span
          v-if="hasDates"
          role="button"
          tabindex="0"
          :aria-label="$t('common.actions.clear')"
          class="text-muted-foreground hover:text-foreground -mr-1 shrink-0 rounded-sm p-0.5"
          @click.stop="clearDates"
          @keydown.enter.stop.prevent="clearDates"
        >
          <XIcon class="size-4" />
        </span>
      </Button>
    </template>
  </DateSelector>
</template>

<script lang="ts" setup>
import { Button } from '@/components/lib/ui/button';
import { type ControlSize } from '@/components/lib/ui/control-size';
import { DateSelector, type DateSelectorPreset } from '@/components/lib/ui/date-selector';
import { type Period } from '@/composable/use-period-navigation';
import { resolveDatePreset } from '@/components/records-filters/saved-views';
import { endOfDay, endOfMonth, endOfYear, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns';
import { CalendarIcon, XIcon } from '@lucide/vue';
import { type PropType, computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps({
  start: {
    type: Date,
    default: null,
  },
  end: {
    type: Date,
    default: null,
  },
  size: {
    type: String as PropType<ControlSize>,
  },
});

const emit = defineEmits(['update:range']);

const { t } = useI18n();

const hasDates = computed(() => props.start !== null && props.end !== null);

const currentPeriod = computed<Period>(() => ({
  from: props.start ?? startOfMonth(new Date()),
  to: props.end ?? endOfMonth(new Date()),
}));

const presets = computed<DateSelectorPreset[]>(() => [
  {
    label: t('transactions.filters.dateRange.presets.thisMonth'),
    getValue: () => resolveDatePreset({ preset: 'thisMonth' }),
  },
  {
    label: t('transactions.filters.dateRange.presets.lastMonth'),
    getValue: () => {
      const lastMonth = subMonths(new Date(), 1);
      return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
    },
  },
  {
    label: t('transactions.filters.dateRange.presets.last3Months'),
    getValue: () => resolveDatePreset({ preset: 'last3Months' }),
  },
  {
    label: t('transactions.filters.dateRange.presets.last6Months'),
    getValue: () => resolveDatePreset({ preset: 'last6Months' }),
  },
  {
    label: t('transactions.filters.dateRange.presets.last12Months'),
    getValue: () => resolveDatePreset({ preset: 'last12Months' }),
  },
  {
    label: t('transactions.filters.dateRange.presets.thisYear'),
    getValue: () => ({ from: startOfYear(new Date()), to: endOfDay(new Date()) }),
  },
  {
    label: t('transactions.filters.dateRange.presets.lastYear'),
    getValue: () => {
      const lastYear = subYears(new Date(), 1);
      return { from: startOfYear(lastYear), to: endOfYear(lastYear) };
    },
  },
]);

function handlePeriodUpdate(period: Period) {
  emit('update:range', { start: period.from, end: period.to });
}

function clearDates() {
  // undefined, not null: DEFAULT_FILTERS uses undefined, and the reset button's
  // disabled check compares with isEqual, which treats them as different.
  emit('update:range', { start: undefined, end: undefined });
}
</script>
