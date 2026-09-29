<script setup lang="ts">
import { Card } from '@/components/lib/ui/card';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import FiltersDialog from '@/components/records-filters/filters-dialog.vue';
import FiltersPanel from '@/components/records-filters/index.vue';
import { useTransactionsWithFilters } from '@/components/records-filters/transactions-with-filters';
import { DEFAULT_SORTING, type TableSorting } from '@/components/transactions-table/columns';
import TransactionsTable from '@/components/transactions-table/transactions-table.vue';
import { useTableColumns } from '@/components/transactions-table/use-table-columns';
import { FILTER_OPERATION } from '@bt/shared/types';
import { useDebounceFn } from '@vueuse/core';
import { computed, ref, watch } from 'vue';

import ReconciliationToolbar from './reconciliation-toolbar.vue';

defineProps<{ isMobileMode: boolean }>();

const FILTER_AUTO_APPLY_DEBOUNCE_MS = 400;

const sorting = ref<TableSorting>({ ...DEFAULT_SORTING });

const {
  filters,
  appliedFilters,
  isResetButtonDisabled,
  isAnyFiltersApplied,
  resetFilters,
  applyFilters,
  transactionsPages,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isFetched,
} = useTransactionsWithFilters({ sorting, staticFilters: { plannedFilter: FILTER_OPERATION.exclude } });

const applyFiltersDebounced = useDebounceFn(applyFilters, FILTER_AUTO_APPLY_DEBOUNCE_MS);
watch(filters, applyFiltersDebounced);

const { visibleColumns } = useTableColumns();

const transactions = computed(() => transactionsPages.value?.pages.flat() ?? []);
const selectionScopeKey = computed(() => JSON.stringify({ filters: appliedFilters.value, sorting: sorting.value }));

const isFiltersDialogOpen = ref(false);
const tableRef = ref<InstanceType<typeof TransactionsTable> | null>(null);

const onSortingChange = (value: TableSorting) => {
  sorting.value = value;
  tableRef.value?.scrollToTop();
};
</script>

<template>
  <div class="flex min-h-0 flex-1 gap-4">
    <Card v-if="!isMobileMode" class="flex w-80 shrink-0 flex-col overflow-hidden p-4">
      <ScrollArea class="-mx-4 min-h-0 flex-1">
        <div class="px-4">
          <FiltersPanel
            v-model:filters="filters"
            :is-reset-button-disabled="isResetButtonDisabled"
            :is-filters-out-of-sync="false"
            hide-planned
            surface="card"
            @reset-filters="resetFilters"
          />
        </div>
      </ScrollArea>
    </Card>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <FiltersDialog
        v-if="isMobileMode"
        v-model:open="isFiltersDialogOpen"
        :is-any-filters-applied="isAnyFiltersApplied"
        class="shrink-0"
      >
        <FiltersPanel
          v-model:filters="filters"
          :is-reset-button-disabled="isResetButtonDisabled"
          :is-filters-out-of-sync="false"
          hide-planned
          @reset-filters="resetFilters"
        />
      </FiltersDialog>

      <Card class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TransactionsTable
          ref="tableRef"
          class="min-h-0 flex-1"
          :transactions="transactions"
          :visible-columns="visibleColumns"
          :sorting="sorting"
          :has-next-page="hasNextPage"
          :is-fetching-next-page="isFetchingNextPage"
          :is-fetched="isFetched"
          :is-mobile-mode="isMobileMode"
          :selection-scope-key="selectionScopeKey"
          row-click-selects
          @update:sorting="onSortingChange"
          @fetch-next-page="fetchNextPage"
          @reset-filters="resetFilters"
        >
          <template #toolbar="{ getSelectedTransactionIds, clearSelection }">
            <ReconciliationToolbar
              :selected-ids="getSelectedTransactionIds()"
              :transactions="transactions"
              @clear-selection="clearSelection"
            />
          </template>
        </TransactionsTable>
      </Card>
    </div>
  </div>
</template>
