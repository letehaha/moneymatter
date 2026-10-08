<template>
  <div class="border-border bg-card space-y-3 rounded-lg border p-4">
    <Teleport defer :to="`#${ANALYTICS_HEADER_ACTIONS_ID}`">
      <Popover v-model:open="isSettingsOpen">
        <PopoverTrigger as-child>
          <Button variant="secondary" size="sm" class="shrink-0 gap-1.5">
            <Settings2Icon class="size-4" />
            <span class="hidden @sm:inline">{{ $t('pivotReport.controls.settings') }}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-72 p-0">
          <!-- Saved views -->
          <div class="p-1">
            <div class="flex items-center justify-between gap-2 px-2 pt-1.5 pb-1">
              <p class="text-muted-foreground text-xs font-medium">
                {{ $t('pivotReport.savedViews.trigger') }}
              </p>
              <span v-if="!activeViewId" class="text-muted-foreground text-xs">
                {{ $t('pivotReport.savedViews.customView') }}
              </span>
            </div>
            <div class="max-h-56 overflow-y-auto">
              <p v-if="savedViews.length === 0" class="text-muted-foreground px-2 py-3 text-center text-sm">
                {{ $t('pivotReport.savedViews.empty') }}
              </p>
              <div v-for="view in savedViews" :key="view.id" class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  :class="
                    cn(
                      'h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 font-normal',
                      view.id === activeViewId && 'bg-accent',
                    )
                  "
                  @click="selectView(view.id)"
                >
                  <CheckIcon :class="cn('size-4 shrink-0', view.id === activeViewId ? 'opacity-100' : 'opacity-0')" />
                  <span class="min-w-0 flex-1 truncate text-left">{{ view.name }}</span>
                </Button>
                <DesktopOnlyTooltip :content="$t('common.actions.delete')">
                  <Button
                    variant="ghost-destructive"
                    size="icon-sm"
                    :aria-label="$t('common.actions.delete')"
                    @click="emit('delete-view', { id: view.id })"
                  >
                    <Trash2Icon class="size-3.5" />
                  </Button>
                </DesktopOnlyTooltip>
              </div>
            </div>
            <div class="border-border mt-1 border-t pt-1">
              <Button variant="secondary" size="sm" class="w-full justify-start gap-2" @click="openSaveDialog">
                <PlusIcon class="size-4" />
                {{ $t('pivotReport.savedViews.saveCurrent') }}
              </Button>
            </div>
          </div>

          <!-- Display options -->
          <div class="border-border space-y-3 border-t p-3">
            <p class="text-muted-foreground text-xs font-medium">
              {{ $t('pivotReport.display.title') }}
            </p>
            <label class="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span>{{ $t('pivotReport.toggles.heatmap') }}</span>
              <Switch v-model="heatmap" />
            </label>
            <label class="flex cursor-pointer items-center justify-between gap-3 text-sm">
              <span>{{ $t('pivotReport.toggles.percentChange') }}</span>
              <Switch v-model="showDelta" />
            </label>
          </div>
        </PopoverContent>
      </Popover>
    </Teleport>

    <DefineFilters v-slot="{ pill }">
      <div :class="pill ? 'min-w-0' : 'w-full'">
        <ComboboxCategories
          v-model:category-ids="categoryIds"
          independent-check-state
          :placeholder="pill ? $t('pivotReport.filters.categories') : undefined"
          :trigger-class="pill ? filterPillClass({ active: categoryIds.length > 0 }) : undefined"
        />
      </div>
      <div :class="pill ? 'min-w-0' : 'w-full'">
        <PayeeMultiSelectField
          :payee-ids="payeeIds"
          :placeholder="pill ? $t('pivotReport.filters.payees') : undefined"
          :trigger-class="pill ? filterPillClass({ active: payeeIds.length > 0 }) : undefined"
          @update:payee-ids="payeeIds = $event"
        />
      </div>
      <div :class="pill ? 'min-w-0' : 'w-full'">
        <AccountMultiSelectField
          :model-value="accountIds"
          exclude-dedicated-flow
          :placeholder="pill ? $t('pivotReport.filters.accounts') : undefined"
          :trigger-class="pill ? filterPillClass({ active: accountIds.length > 0 }) : undefined"
          @update:model-value="accountIds = $event"
        />
      </div>
    </DefineFilters>

    <div class="flex items-center justify-between gap-3">
      <!-- Report shape: one joined strip; from @6xl each control renders its own segmented tabs. -->
      <div
        class="border-border divide-border bg-background grid min-w-0 flex-1 grid-cols-3 divide-x overflow-hidden rounded-md border @xl/pivot-report:w-fit @xl/pivot-report:flex-none @xl/pivot-report:grid-cols-[repeat(3,auto)] @6xl/pivot-report:flex @6xl/pivot-report:w-auto @6xl/pivot-report:flex-1 @6xl/pivot-report:flex-wrap @6xl/pivot-report:gap-x-5 @6xl/pivot-report:gap-y-2 @6xl/pivot-report:divide-x-0 @6xl/pivot-report:overflow-visible @6xl/pivot-report:rounded-none @6xl/pivot-report:border-0 @6xl/pivot-report:bg-transparent [&>:first-child_button]:rounded-l-md [&>:last-child_button]:rounded-r-md"
      >
        <PivotDimensionControl
          :label="$t('pivotReport.controls.rows')"
          :items="rowDimensionItems"
          :model-value="rowDimension"
          @update:model-value="(value) => (rowDimension = value as endpointsTypes.PivotRowDimension)"
        />
        <PivotDimensionControl
          :label="$t('pivotReport.controls.columns')"
          :items="granularityItems"
          :model-value="granularity"
          @update:model-value="(value) => (granularity = value as endpointsTypes.PivotGranularity)"
        />
        <PivotDimensionControl
          :label="$t('pivotReport.controls.measure')"
          :items="measureItems"
          :model-value="measure"
          @update:model-value="(value) => (measure = value as endpointsTypes.PivotMeasure)"
        />
      </div>

      <!-- Resets shape, period and filters, so it sits at card level rather than in the filter row. -->
      <div v-if="canReset" class="hidden shrink-0 @2xl/pivot-report:block">
        <DesktopOnlyTooltip :content="$t('pivotReport.filters.resetTooltip')">
          <Button type="button" variant="ghost" size="sm" class="h-8 gap-1.5 font-normal" @click="emit('reset')">
            <RotateCcwIcon class="size-3.5 shrink-0" />
            {{ $t('pivotReport.filters.reset') }}
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </div>

    <!-- Data scope: the row never wraps. Filters truncate inline from @2xl and fold behind one button below it. -->
    <div class="flex items-center gap-2">
      <DateSelector v-model="period" :presets="periodPresets" :earliest-date="earliestDate">
        <template #trigger="{ triggerText }">
          <FilterPill
            :label="$t('pivotReport.filters.period')"
            :value="triggerText"
            :icon="CalendarIcon"
            class="flex-1 @2xl/pivot-report:flex-none"
          />
        </template>
      </DateSelector>

      <div class="hidden min-w-0 items-center gap-2 @2xl/pivot-report:flex">
        <ReuseFilters :pill="true" />
      </div>

      <FiltersButton
        :label="$t('pivotReport.filters.button')"
        :active-count="activeFilterCount"
        class="@2xl/pivot-report:hidden"
      >
        <div class="flex flex-col gap-3">
          <ReuseFilters />
        </div>
      </FiltersButton>

      <div v-if="canReset" class="shrink-0 @2xl/pivot-report:hidden">
        <DesktopOnlyTooltip :content="$t('pivotReport.filters.resetTooltip')">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-9"
            :aria-label="$t('pivotReport.filters.reset')"
            @click="emit('reset')"
          >
            <RotateCcwIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </div>

    <!-- Save-view dialog -->
    <ResponsiveDialog v-model:open="isSaveDialogOpen">
      <template #title>{{ $t('pivotReport.savedViews.dialogTitle') }}</template>
      <template #description>{{ $t('pivotReport.savedViews.dialogDescription') }}</template>

      <form class="space-y-4" @submit.prevent="submitSaveView">
        <InputField
          v-model="newViewName"
          :label="$t('pivotReport.savedViews.nameLabel')"
          :placeholder="$t('pivotReport.savedViews.namePlaceholder')"
          :maxlength="endpointsTypes.SAVED_PIVOT_VIEW_NAME_MAX_LENGTH"
          autofocus
        />
      </form>

      <template #footer="{ close }">
        <Button variant="ghost" @click="close">{{ $t('common.actions.cancel') }}</Button>
        <Button :disabled="!canSubmitView || isSavingView" :loading="isSavingView" @click="submitSaveView">
          {{ $t('common.actions.save') }}
        </Button>
      </template>
    </ResponsiveDialog>
  </div>
</template>

<script setup lang="ts">
import type { SavedPivotView } from '@/api/user-settings';
import ComboboxCategories from '@/components/common/combobox-categories.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import PayeeMultiSelectField from '@/components/fields/payee-multi-select-field.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { DateSelector, type DateSelectorPreset } from '@/components/lib/ui/date-selector';
import { type PillTabItem } from '@/components/lib/ui/pill-tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/lib/ui/popover';
import { Switch } from '@/components/lib/ui/switch';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useEarliestTransactionDate } from '@/composable/data-queries/earliest-transaction-date';
import type { Period } from '@/composable/use-period-navigation';
import { cn } from '@/lib/utils';
import FiltersButton from '@/pages/analytics/components/filters-button.vue';
import { ANALYTICS_HEADER_ACTIONS_ID } from '@/pages/analytics/utils';
import { endpointsTypes } from '@bt/shared/types';
import { createReusableTemplate } from '@vueuse/core';
import { endOfMonth, endOfYear, startOfMonth, startOfYear, subMonths, subYears } from 'date-fns';
import { CalendarIcon, CheckIcon, PlusIcon, RotateCcwIcon, Settings2Icon, Trash2Icon } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { filterPillClass } from './filter-pill.helpers';
import FilterPill from './filter-pill.vue';
import PivotDimensionControl from './pivot-dimension-control.vue';

const props = defineProps<{
  savedViews: SavedPivotView[];
  activeViewId: string | null;
  isSavingView: boolean;
  canReset: boolean;
}>();

const emit = defineEmits<{
  'save-view': [payload: { name: string }];
  'select-view': [payload: { id: string }];
  'delete-view': [payload: { id: string }];
  reset: [];
}>();

const rowDimension = defineModel<endpointsTypes.PivotRowDimension>('rowDimension', { required: true });
const granularity = defineModel<endpointsTypes.PivotGranularity>('granularity', { required: true });
const measure = defineModel<endpointsTypes.PivotMeasure>('measure', { required: true });
const period = defineModel<Period>('period', { required: true });
const accountIds = defineModel<string[]>('accountIds', { required: true });
const categoryIds = defineModel<string[]>('categoryIds', { required: true });
const payeeIds = defineModel<string[]>('payeeIds', { required: true });
const heatmap = defineModel<boolean>('heatmap', { required: true });
const showDelta = defineModel<boolean>('showDelta', { required: true });

const { t } = useI18n();
const { earliestDate } = useEarliestTransactionDate();

const rowDimensionItems = computed<PillTabItem[]>(() => [
  { value: 'category', label: t('pivotReport.dimensions.category') },
  { value: 'subcategory', label: t('pivotReport.dimensions.subcategory') },
  { value: 'payee', label: t('pivotReport.dimensions.payee') },
  { value: 'tag', label: t('pivotReport.dimensions.tag') },
]);

const granularityItems = computed<PillTabItem[]>(() => [
  { value: 'yearly', label: t('pivotReport.granularity.yearly') },
  { value: 'quarterly', label: t('pivotReport.granularity.quarterly') },
  { value: 'monthly', label: t('pivotReport.granularity.monthly') },
  { value: 'weekly', label: t('pivotReport.granularity.weekly') },
]);

const measureItems = computed<PillTabItem[]>(() => [
  { value: 'expense', label: t('pivotReport.measure.expense') },
  { value: 'income', label: t('pivotReport.measure.income') },
]);

const periodPresets = computed<DateSelectorPreset[]>(() => [
  {
    label: t('pivotReport.periods.last6Months'),
    getValue: () => ({ from: startOfMonth(subMonths(new Date(), 5)), to: endOfMonth(new Date()) }),
  },
  {
    label: t('pivotReport.periods.last12Months'),
    getValue: () => ({ from: startOfMonth(subMonths(new Date(), 11)), to: endOfMonth(new Date()) }),
  },
  {
    label: t('pivotReport.periods.thisYear'),
    getValue: () => ({ from: startOfYear(new Date()), to: new Date() }),
  },
  {
    label: t('pivotReport.periods.previousYear'),
    getValue: () => {
      const prev = subYears(new Date(), 1);
      return { from: startOfYear(prev), to: endOfYear(prev) };
    },
  },
  {
    label: t('pivotReport.periods.last3Years'),
    getValue: () => ({ from: startOfYear(subYears(new Date(), 2)), to: endOfYear(new Date()) }),
  },
  {
    label: t('pivotReport.periods.last5Years'),
    getValue: () => ({ from: startOfYear(subYears(new Date(), 4)), to: endOfYear(new Date()) }),
  },
  {
    label: t('pivotReport.periods.allTime'),
    // Fallback start covers the case where the earliest-date query hasn't resolved:
    // far enough back to include any realistic personal-finance history.
    getValue: () => ({ from: earliestDate.value ?? new Date(2000, 0, 1), to: new Date() }),
  },
]);

const [DefineFilters, ReuseFilters] = createReusableTemplate<{ pill?: boolean }>();

const activeFilterCount = computed(
  () => [categoryIds.value, payeeIds.value, accountIds.value].filter((ids) => ids.length > 0).length,
);

const isSettingsOpen = ref(false);
const isSaveDialogOpen = ref(false);
const newViewName = ref('');

const canSubmitView = computed(() => {
  const trimmed = newViewName.value.trim();
  return trimmed.length > 0 && trimmed.length <= endpointsTypes.SAVED_PIVOT_VIEW_NAME_MAX_LENGTH;
});

const selectView = (id: string) => {
  emit('select-view', { id });
  isSettingsOpen.value = false;
};

const openSaveDialog = () => {
  newViewName.value = '';
  isSettingsOpen.value = false;
  isSaveDialogOpen.value = true;
};

const submitSaveView = () => {
  if (!canSubmitView.value || props.isSavingView) return;
  emit('save-view', { name: newViewName.value.trim() });
  isSaveDialogOpen.value = false;
};
</script>
