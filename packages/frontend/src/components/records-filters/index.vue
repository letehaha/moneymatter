<template>
  <div class="grid gap-4">
    <DateRangeFilter
      :start="filters.start"
      :end="filters.end"
      @update:range="$emit('update:filters', { ...filters, start: $event.start, end: $event.end })"
    />

    <TransactionTypeFilter
      :value="filters.transactionType ?? undefined"
      @update:value="$emit('update:filters', { ...filters, transactionType: $event })"
    />

    <AmountRangeFilter
      :amount-gte="filters.amountGte"
      :amount-lte="filters.amountLte"
      @update:amount-gte="$emit('update:filters', { ...filters, amountGte: $event })"
      @update:amount-lte="$emit('update:filters', { ...filters, amountLte: $event })"
    />

    <ExclusionsFilter
      :refund-filter="filters.refundFilter"
      :transfer-filter="filters.transferFilter"
      :planned-filter="filters.plannedFilter"
      :hide-planned="hidePlanned"
      @update:refund-filter="$emit('update:filters', { ...filters, refundFilter: $event })"
      @update:transfer-filter="$emit('update:filters', { ...filters, transferFilter: $event })"
      @update:planned-filter="$emit('update:filters', { ...filters, plannedFilter: $event })"
    />

    <TransferNatureFilter
      :transfer-natures="filters.transferNatures"
      :transfer-filter="filters.transferFilter"
      @update:transfer-natures="$emit('update:filters', { ...filters, transferNatures: $event })"
    />

    <NoteIncludesFilter
      :note-includes="filters.noteIncludes"
      @update:note-includes="$emit('update:filters', { ...filters, noteIncludes: $event })"
    />

    <OperationPills
      :label="$t('transactions.filters.attachments.label')"
      :model-value="filters.attachmentFilter"
      @update:model-value="$emit('update:filters', { ...filters, attachmentFilter: $event })"
    />

    <AccountMultiSelectField
      :model-value="filters.accountIds"
      include-archived
      @update:model-value="$emit('update:filters', { ...filters, accountIds: $event })"
    />

    <ComboboxCategories
      :category-ids="filters.categoryIds"
      @update:category-ids="$emit('update:filters', { ...filters, categoryIds: $event })"
    />

    <TagFilter
      allow-blank
      :tag-ids="filters.tagIds"
      @update:tag-ids="$emit('update:filters', { ...filters, tagIds: $event })"
    />

    <PayeeMultiSelectField
      allow-blank
      :payee-ids="filters.payeeIds"
      @update:payee-ids="$emit('update:filters', { ...filters, payeeIds: $event })"
    />

    <BudgetMultiSelectField
      v-if="!hideBudgets"
      :budget-ids="filters.budgetIds"
      @update:budget-ids="$emit('update:filters', { ...filters, budgetIds: $event })"
    />
  </div>

  <div :class="cn('sticky -bottom-px mt-4 flex gap-2', surface === 'card' ? 'bg-card' : 'bg-dialog')">
    <UiButton
      variant="secondary"
      :disabled="isResetButtonDisabled"
      class="w-full shrink"
      @click="$emit('reset-filters')"
    >
      {{ $t('transactions.filters.reset') }}
    </UiButton>

    <template v-if="isFiltersOutOfSync">
      <UiButton variant="default" class="w-full shrink" @click="$emit('apply-filters')">
        {{ $t('transactions.filters.apply') }}
      </UiButton>
    </template>
  </div>
</template>

<script lang="ts" setup>
import UiButton from '@/components/lib/ui/button/Button.vue';
import { cn } from '@/lib/utils';

import AccountMultiSelectField from '@/components/fields/account-multi-select-field.vue';
import BudgetMultiSelectField from '@/components/fields/budget-multi-select-field.vue';
import ComboboxCategories from '@/components/common/combobox-categories.vue';

import { FiltersStruct } from './const';
import AmountRangeFilter from './filters/amount-range-filter.vue';
import DateRangeFilter from './filters/date-range-filter.vue';
import ExclusionsFilter from './filters/exclusions.vue';
import NoteIncludesFilter from './filters/note-includes.vue';
import OperationPills from './filters/operation-pills.vue';
import PayeeMultiSelectField from '@/components/fields/payee-multi-select-field.vue';
import TagFilter from './filters/tag-filter.vue';
import TransactionTypeFilter from './filters/transaction-type-filter.vue';
import TransferNatureFilter from './filters/transfer-nature-filter.vue';

withDefaults(
  defineProps<{
    filters: FiltersStruct;
    isResetButtonDisabled: boolean;
    isFiltersOutOfSync: boolean;
    /** Surface the sticky footer must blend with: the panel renders both in dialogs and inline on cards. */
    surface?: 'dialog' | 'card';
    /** Hosts already scoped to one budget (the budget page) hide the budget picker. */
    hideBudgets?: boolean;
    hidePlanned?: boolean;
  }>(),
  { surface: 'dialog' },
);

defineEmits(['update:filters', 'reset-filters', 'apply-filters']);
</script>
