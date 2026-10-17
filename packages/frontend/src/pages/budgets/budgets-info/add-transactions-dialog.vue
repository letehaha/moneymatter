<script setup lang="ts">
import { addTransactionsToBudget } from '@/api/budgets';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import Checkbox from '@/components/lib/ui/checkbox/Checkbox.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import RecordsFiltersDialog from '@/components/records-filters/filters-dialog.vue';
import RecordsFilters from '@/components/records-filters/index.vue';
import { useTransactionsWithFilters } from '@/components/records-filters/transactions-with-filters';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { useShiftMultiSelect } from '@/composable/shift-multi-select';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { useWindowBreakpoints } from '@/composable/window-breakpoints';
import { extractApiErrorMessage } from '@/js/errors';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';

import { useInvalidateTracker } from '../components/use-tracker-actions';

const { t } = useI18n();

const route = useRoute();
const { addErrorNotification } = useNotificationCenter();
const invalidateTracker = useInvalidateTracker();

const pickedTransactionsIds = reactive<Set<string>>(new Set());
const { handleSelection, resetSelection, isShiftKeyPressed } = useShiftMultiSelect(pickedTransactionsIds);

const isAddingTransactionModalVisible = ref<boolean>(false);
const currentBudgetId = ref<string>(String(route.params.id));
const isTransactionsPicked = computed(() => !!pickedTransactionsIds.size);
const {
  isResetButtonDisabled,
  isFiltersOutOfSync,
  resetFilters,
  applyFilters,
  appliedFilters,
  isAnyFiltersApplied,
  filters,
  transactionsPages,
  fetchNextPage: fetchNextTransactionPage,
  hasNextPage: hasNextTransactionsPage,
  isFetchingNextPage: isFetchingNextTransactionsPage,
} = useTransactionsWithFilters({
  appendQueryKey: [currentBudgetId],
  queryEnabled: isAddingTransactionModalVisible,
  staticFilters: { excludedBudgetIds: [currentBudgetId.value] },
});

const addTransactions = async () => {
  const data = {
    transactionIds: [...pickedTransactionsIds.values()],
  };
  try {
    await addTransactionsToBudget(currentBudgetId.value, data);
    invalidateTracker({ budgetId: currentBudgetId.value });
    isAddingTransactionModalVisible.value = false;
    resetSelection();
  } catch (err: unknown) {
    addErrorNotification(extractApiErrorMessage(err) || t('pages.budgets.transactionsList.addError'));
  }
};

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const parentRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);

const flatTransactions = computed(() => transactionsPages.value?.pages?.flat() ?? []);

const { virtualRows, totalSize } = useVirtualizedInfiniteScroll({
  items: flatTransactions,
  hasNextPage: hasNextTransactionsPage,
  fetchNextPage: fetchNextTransactionPage,
  isFetchingNextPage: isFetchingNextTransactionsPage,
  parentRef,
  enabled: isAddingTransactionModalVisible,
  getItemKey: (index) => flatTransactions.value[index]!.id,
});

const isFiltersDialogOpen = ref(false);

watch(appliedFilters, () => {
  isFiltersDialogOpen.value = false;
});

const isMobileView = useWindowBreakpoints(1024);
</script>

<template>
  <ResponsiveDialog
    v-model:open="isAddingTransactionModalVisible"
    dialogContentClass="max-w-[900px] h-[85vh]"
    no-internal-scroll
  >
    <template #trigger>
      <slot />
    </template>

    <template #title>
      <span>{{ t('budgets.addTransactionsDialog.title') }}</span>
    </template>

    <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[max-content_minmax(0,1fr)]">
      <div class="relative min-h-0 overflow-y-auto px-1">
        <template v-if="isMobileView">
          <RecordsFiltersDialog v-model:open="isFiltersDialogOpen" :isAnyFiltersApplied="isAnyFiltersApplied">
            <div class="relative max-h-[calc(100vh-var(--header-height)-32px)] overflow-auto">
              <RecordsFilters
                v-model:filters="filters"
                :is-reset-button-disabled="isResetButtonDisabled"
                :is-filters-out-of-sync="isFiltersOutOfSync"
                @reset-filters="resetFilters"
                @apply-filters="applyFilters"
              />
            </div>
          </RecordsFiltersDialog>
        </template>
        <template v-else>
          <RecordsFilters
            v-model:filters="filters"
            :is-reset-button-disabled="isResetButtonDisabled"
            :is-filters-out-of-sync="isFiltersOutOfSync"
            @reset-filters="resetFilters"
            @apply-filters="applyFilters"
          />
        </template>
      </div>

      <div v-if="transactionsPages" class="relative flex min-h-0 w-full flex-col">
        <ScrollArea ref="scrollAreaRef" class="min-h-0 flex-1" viewport-class="h-full">
          <div :style="{ height: `${totalSize}px`, position: 'relative' }">
            <div
              v-for="virtualRow in virtualRows"
              :key="String(virtualRow.key)"
              :style="{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <label
                v-if="flatTransactions[virtualRow.index]"
                :class="[
                  'grid grid-cols-[min-content_minmax(0,1fr)] items-center gap-2 pr-3',
                  { 'select-none': isShiftKeyPressed },
                ]"
              >
                <Checkbox
                  :model-value="pickedTransactionsIds.has(flatTransactions[virtualRow.index]!.id)"
                  @update:model-value="
                    handleSelection(
                      !!$event,
                      flatTransactions[virtualRow.index]!.id,
                      virtualRow.index,
                      flatTransactions,
                      (v) => v.id,
                    )
                  "
                />
                <TransactionRecord :tx="flatTransactions[virtualRow.index]!" />
              </label>
              <div v-else class="flex h-13 items-center justify-center">{{ t('transactions.list.loadingMore') }}</div>
            </div>
          </div>
          <template v-if="!hasNextTransactionsPage">
            <p class="flex justify-center">{{ t('transactions.list.noMoreData') }}</p>
          </template>
        </ScrollArea>

        <div v-if="isTransactionsPicked" class="flex shrink-0 gap-2 border-t pt-3">
          <Button type="button" variant="outline" class="w-full" @click="resetSelection">
            {{ t('budgets.addTransactionsDialog.clearSelection') }}
          </Button>
          <Button type="button" class="w-full" @click="addTransactions">
            {{ t('budgets.addTransactionsDialog.addSelected') }}
          </Button>
        </div>
      </div>
    </div>
  </ResponsiveDialog>
</template>
