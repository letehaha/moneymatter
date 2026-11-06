<script setup lang="ts">
import { type RefundRole, loadRefundRecommendations, loadTransactions } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import DateField from '@/components/fields/date-field.vue';
import InputField from '@/components/fields/input-field.vue';
import Button from '@/components/lib/ui/button/Button.vue';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import TransactionRecordSkeleton from '@/components/transactions-list/transaction-record-skeleton.vue';
import TransactionRecrod from '@/components/transactions-list/transaction-record.vue';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { cn } from '@/lib/utils';
import { TRANSACTION_TYPES, TransactionModel } from '@bt/shared/types';
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query';
import { refDebounced, useResizeObserver } from '@vueuse/core';
import { endOfDay, isDate, startOfDay } from 'date-fns';
import { isEqual, isNil, omitBy } from 'lodash-es';
import { CircleAlert, ListFilterIcon, SearchIcon, SparklesIcon } from '@lucide/vue';
import { computed, ref } from 'vue';

import { getOppositeTxType } from '../../helpers';
import { isDatedAfterPivotDay } from '../../utils/derive-refund-role';

interface RecordListModalProps {
  /** Type of the rows to list: the opposite of the entry being linked. */
  transactionType: TRANSACTION_TYPES;
  selectedTransactions: TransactionModel[];
  /** Saved links of the current entry; listed even when the server filters drop them. */
  savedTransactions?: TransactionModel[];
  onSelect: (item: TransactionModel) => void;
  /** Side of the link the current entry is on; `null` until the first tick decides it. */
  role: RefundRole | null;
  /** Live form time of the current entry. */
  currentTime: Date;
  isRecordCreation?: boolean;
  /** Origin transaction ID (for recommendations when editing) */
  originTransactionId?: string;
  /** Origin transaction amount for recommendations (used when creating new tx) */
  originAmount?: number | null;
  /** Origin account ID for recommendations (used when creating new tx) */
  originAccountId?: string | null;
}

const props = defineProps<RecordListModalProps>();

const pivot = computed(() => ({
  refundPivotFrom: startOfDay(props.currentTime).toISOString(),
  refundPivotTo: endOfDay(props.currentTime).toISOString(),
}));

// Until the role is known, the server keeps earlier rows that can be originals and later rows
// that can be refunds; `keepRefundsForTxId` spares the current entry's own links either way.
const roleFilters = computed(() => {
  if (props.role === 'refund') return { excludeRefundTxs: true, keepRefundsForTxId: props.originTransactionId };
  if (props.role === 'original') {
    return { excludeRefundTxs: true, excludeRefundedTxs: true, keepRefundsForTxId: props.originTransactionId };
  }
  return { ...pivot.value, keepRefundsForTxId: props.originTransactionId };
});

// The create API can only save "this new entry refunds an earlier row".
const isRowSelectable = (tx: TransactionModel) =>
  !props.isRecordCreation || !isDatedAfterPivotDay({ rowTime: tx.time, currentTime: props.currentTime });

const DEFAULT_FILTERS: {
  start: Date | undefined;
  end: Date | undefined;
  amountGte: number | null;
  amountLte: number | null;
} = {
  // TODO: by accounts
  // TODO: by categories
  start: undefined,
  end: undefined,
  amountGte: null,
  amountLte: null,
};

const isFiltersDialogOpen = ref(false);
const filters = ref({ ...DEFAULT_FILTERS });
const appliedFilters = ref({ ...DEFAULT_FILTERS });

const SEARCH_DEBOUNCE_MS = 350;
const searchQuery = ref('');
const debouncedSearchQuery = refDebounced(searchQuery, SEARCH_DEBOUNCE_MS);
const noteSearch = computed(() => debouncedSearchQuery.value.trim() || undefined);
const isSearchActive = computed(() => Boolean(noteSearch.value));

const isResetButtonDisabled = computed(() => isEqual(filters.value, DEFAULT_FILTERS));
const isAnyFiltersApplied = computed(() => !isEqual(appliedFilters.value, DEFAULT_FILTERS));
const isFiltersOutOfSync = computed(() => !isEqual(filters.value, appliedFilters.value));
const resetFilters = () => {
  filters.value = { ...DEFAULT_FILTERS };
  appliedFilters.value = { ...DEFAULT_FILTERS };
  isFiltersDialogOpen.value = false;
};
const applyFilters = () => {
  appliedFilters.value = { ...filters.value };
  isFiltersDialogOpen.value = false;
};

// Check if we can fetch recommendations
// Either: have transactionId (editing) OR have form data (creating)
const canFetchRecommendations = computed(() => {
  if (isAnyFiltersApplied.value) return false;

  // Option 1: Have transaction ID (editing existing transaction)
  if (props.originTransactionId) return true;

  // Option 2: Have form data (creating new transaction)
  return !!(props.originAmount && props.originAmount > 0 && props.originAccountId);
});

const recommendationsQueryParams = computed(() => ({
  ...(props.originTransactionId
    ? { transactionId: props.originTransactionId }
    : {
        transactionType: getOppositeTxType(props.transactionType),
        originAmount: props.originAmount!,
        accountId: props.originAccountId!,
      }),
  refundRole: props.role ?? undefined,
  ...pivot.value,
  includeRefundedAmount: true,
}));

// Both queries cache forever, so everything that changes the server filter is part of the key.
const { data: recommendations } = useQuery({
  queryKey: [
    ...VUE_QUERY_CACHE_KEYS.recordsPageTransactionList,
    'recommendations',
    props.originTransactionId,
    props.transactionType,
    props.originAmount,
    props.originAccountId,
    computed(() => props.role),
    computed(() => props.currentTime.getTime()),
  ],
  queryFn: () => loadRefundRecommendations(recommendationsQueryParams.value),
  enabled: canFetchRecommendations,
  staleTime: Infinity,
});

const selectedTxsIds = computed(() => new Set(props.selectedTransactions.map((i) => i.id)));
const recommendationIds = computed(() => new Set(recommendations.value?.map((r) => r.id) ?? []));
const recommendedRows = computed(() => recommendations.value ?? []);

const limit = 15;
const fetchTransactions = ({
  pageParam,
  filter,
  search,
}: {
  pageParam: number;
  filter: typeof appliedFilters.value;
  search: string | undefined;
}) => {
  const offset = pageParam * limit;

  return loadTransactions(
    omitBy(
      {
        limit,
        offset,
        transactionType: props.transactionType,
        excludeTransfer: true,
        ...roleFilters.value,
        // Planned rows can't be refund-linked, so they are not valid candidates either.
        isPlanned: false,
        includeRefundedAmount: true,
        noteSearch: search,
        to: isDate(filter.end) ? filter.end!.toISOString() : undefined,
        from: isDate(filter.start) ? filter.start!.toISOString() : undefined,
        amountGte: filter.amountGte ?? undefined,
        amountLte: filter.amountLte ?? undefined,
      },
      isNil,
    ) as unknown as Parameters<typeof loadTransactions>[0],
  );
};

const {
  data: transactionsPages,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isFetched,
} = useInfiniteQuery({
  queryKey: [
    ...VUE_QUERY_CACHE_KEYS.recordsPageTransactionList,
    props.transactionType,
    props.originTransactionId,
    computed(() => props.role),
    computed(() => props.currentTime.getTime()),
    appliedFilters,
    noteSearch,
  ],
  queryFn: ({ pageParam }) => fetchTransactions({ pageParam, filter: appliedFilters.value, search: noteSearch.value }),
  initialPageParam: 0,
  getNextPageParam: (lastPage, pages) => {
    // No more pages to load
    if (lastPage.length < limit) return undefined;
    // returns the number of pages fetched so far as the next page param
    return pages.length;
  },
  staleTime: Infinity,
});

const showRecommendations = computed(
  () => Boolean(recommendedRows.value.length) && !isAnyFiltersApplied.value && !isSearchActive.value,
);

// A refund shared with another purchase fails the purchase-side filters, so saved links are
// prepended here; without that a ticked link could not be seen or unticked.
const savedRows = computed(() =>
  isAnyFiltersApplied.value || isSearchActive.value ? [] : (props.savedTransactions ?? []),
);

// Recommendations are excluded from the main list only while their own section renders them.
const filteredTransactions = computed(() => {
  const hiddenIds = showRecommendations.value ? recommendationIds.value : new Set<string>();
  const saved = savedRows.value.filter((tx) => !hiddenIds.has(tx.id));
  const savedIds = new Set(saved.map((tx) => tx.id));
  const fetched = (transactionsPages.value?.pages?.flat() ?? []).filter(
    (tx) => !hiddenIds.has(tx.id) && !savedIds.has(tx.id),
  );
  return [...saved, ...fetched];
});

const handlerRecordClick = (transaction: TransactionModel) => {
  if (isRowSelectable(transaction)) props.onSelect(transaction);
};

const hasAnyTransactions = computed(() => recommendedRows.value.length > 0 || filteredTransactions.value.length > 0);

// 32px compact record (24px category circle + py-1) + the 1px selection border it is wrapped in
const TRANSACTION_ROW_HEIGHT = 34;

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const parentRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);

// The recommendations block scrolls with the list, so the virtualizer needs the
// distance it pushes the rows down to map scroll position onto them.
const scrollContentRef = ref<HTMLElement | null>(null);
const listContainerRef = ref<HTMLElement | null>(null);
const scrollMargin = ref(0);
useResizeObserver(scrollContentRef, () => {
  const listEl = listContainerRef.value;
  const scrollEl = parentRef.value;
  if (!listEl || !scrollEl) return;
  scrollMargin.value = listEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
});

const { virtualRows, totalSize } = useVirtualizedInfiniteScroll({
  items: filteredTransactions,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  parentRef,
  scrollMargin,
  estimateSize: () => TRANSACTION_ROW_HEIGHT,
  getItemKey: (index) => filteredTransactions.value[index]!.id,
});
</script>

<template>
  <div class="flex min-h-0 grow flex-col gap-2">
    <div class="flex items-center gap-2 px-2 pt-1">
      <div class="min-w-0 flex-1">
        <InputField
          v-model="searchQuery"
          :placeholder="$t('dialogs.manageTransaction.refundRecordsList.searchPlaceholder')"
        >
          <template #iconLeading>
            <SearchIcon class="text-muted-foreground size-4" />
          </template>
        </InputField>
      </div>

      <DesktopOnlyTooltip :content="$t('dialogs.manageTransaction.refundRecordsList.filtersLabel')">
        <span class="inline-flex">
          <ResponsiveDialog v-model:open="isFiltersDialogOpen" dialog-content-class="max-w-[350px]">
            <template #trigger>
              <Button
                variant="ghost"
                size="icon"
                :aria-label="$t('dialogs.manageTransaction.refundRecordsList.filtersLabel')"
              >
                <div class="relative">
                  <ListFilterIcon />

                  <template v-if="isAnyFiltersApplied">
                    <div class="bg-primary absolute -top-1 -right-1 size-3 rounded-full" />
                  </template>
                </div>
              </Button>
            </template>

            <template #title>{{ $t('dialogs.manageTransaction.refundRecordsList.filtersDialogTitle') }}</template>

            <div class="grid gap-4">
              <DateField
                v-model="filters.start"
                :calendar-options="{
                  maxDate: filters.end,
                }"
                :label="$t('dialogs.manageTransaction.refundRecordsList.fromDateLabel')"
              />
              <DateField
                v-model="filters.end"
                :calendar-options="{
                  minDate: filters.start,
                }"
                :label="$t('dialogs.manageTransaction.refundRecordsList.toDateLabel')"
              />

              <div class="flex gap-2">
                <InputField
                  v-model="filters.amountGte"
                  :label="$t('dialogs.manageTransaction.refundRecordsList.amountFromLabel')"
                  :placeholder="$t('dialogs.manageTransaction.refundRecordsList.amountFromPlaceholder')"
                />
                <InputField
                  v-model="filters.amountLte"
                  :label="$t('dialogs.manageTransaction.refundRecordsList.amountToLabel')"
                  :placeholder="$t('dialogs.manageTransaction.refundRecordsList.amountToPlaceholder')"
                />
              </div>

              <div class="flex gap-2">
                <Button
                  variant="secondary"
                  :disabled="isResetButtonDisabled"
                  class="w-full shrink"
                  @click="resetFilters"
                >
                  {{ $t('dialogs.manageTransaction.refundRecordsList.resetButton') }}
                </Button>

                <template v-if="isFiltersOutOfSync">
                  <Button variant="default" class="w-full shrink" @click="applyFilters">
                    {{ $t('dialogs.manageTransaction.refundRecordsList.applyButton') }}
                  </Button>
                </template>
              </div>
            </div>
          </ResponsiveDialog>
        </span>
      </DesktopOnlyTooltip>
    </div>

    <ScrollArea ref="scrollAreaRef" class="min-h-0 flex-1" viewport-class="h-full">
      <div ref="scrollContentRef">
        <!-- Recommendations section -->
        <template v-if="showRecommendations">
          <div class="mb-3">
            <div class="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
              <SparklesIcon class="size-3.5" />
              <span>{{ $t('dialogs.manageTransaction.refundRecordsList.recommendedLabel') }}</span>
            </div>
            <div class="space-y-1">
              <div
                v-for="item in recommendedRows"
                :key="item.id"
                :class="
                  cn(
                    'rounded-xl border border-transparent transition-colors',
                    selectedTxsIds.has(item.id) && 'border-primary/70 bg-primary/10',
                    !isRowSelectable(item) && 'opacity-60',
                  )
                "
              >
                <TransactionRecrod
                  :tx="item"
                  compact
                  show-checkbox
                  :is-selectable="isRowSelectable(item)"
                  :unselectable-hint="$t('dialogs.manageTransaction.markAsRefund.refundedByCreationHint')"
                  :is-selected="selectedTxsIds.has(item.id)"
                  @record-click="(payload) => handlerRecordClick(payload[0])"
                  @selection-change="handlerRecordClick(item)"
                />
              </div>
            </div>
          </div>

          <!-- Divider between recommendations and all transactions -->
          <template v-if="filteredTransactions.length">
            <div class="text-muted-foreground mb-2 text-xs font-medium">
              {{ $t('dialogs.manageTransaction.refundRecordsList.allTransactionsLabel') }}
            </div>
          </template>
        </template>

        <!-- All transactions section -->
        <div
          v-if="isFetched && transactionsPages"
          ref="listContainerRef"
          :style="{ height: `${totalSize}px`, position: 'relative' }"
        >
          <div
            v-for="virtualRow in virtualRows"
            :key="String(virtualRow.key)"
            :style="{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }"
          >
            <div
              v-if="filteredTransactions[virtualRow.index]"
              :class="
                cn(
                  'rounded-xl border border-transparent transition-colors',
                  selectedTxsIds.has(filteredTransactions[virtualRow.index]!.id) && 'border-primary/70 bg-primary/10',
                  !isRowSelectable(filteredTransactions[virtualRow.index]!) && 'opacity-60',
                )
              "
            >
              <TransactionRecrod
                :tx="filteredTransactions[virtualRow.index]!"
                compact
                show-checkbox
                :is-selectable="isRowSelectable(filteredTransactions[virtualRow.index]!)"
                :unselectable-hint="$t('dialogs.manageTransaction.markAsRefund.refundedByCreationHint')"
                :is-selected="selectedTxsIds.has(filteredTransactions[virtualRow.index]!.id)"
                @record-click="(payload) => handlerRecordClick(payload[0])"
                @selection-change="handlerRecordClick(filteredTransactions[virtualRow.index]!)"
              />
            </div>
            <div v-else class="flex h-8 items-center justify-center text-sm">
              {{ $t('transactions.list.loadingMore') }}
            </div>
          </div>
        </div>
        <div v-else class="space-y-1">
          <TransactionRecordSkeleton v-for="i in 6" :key="i" compact />
        </div>

        <template v-if="isFetched && !hasNextPage && hasAnyTransactions">
          <p class="mt-4 text-center text-sm">
            {{ $t('dialogs.manageTransaction.refundRecordsList.noMoreTransactions') }}
          </p>
        </template>
        <template v-else-if="isFetched && !hasNextPage">
          <div
            class="text-muted-foreground flex min-h-[min(20rem,50dvh)] flex-col items-center justify-center gap-4 px-6 text-center text-sm"
          >
            <CircleAlert :size="48" />
            <p>
              <template v-if="isSearchActive">
                {{ $t('dialogs.manageTransaction.refundRecordsList.noSearchResults', { query: noteSearch }) }}
              </template>
              <template v-else-if="transactionType === TRANSACTION_TYPES.income">
                {{ $t('dialogs.manageTransaction.refundRecordsList.noIncomeTransactions') }}
              </template>
              <template v-else-if="transactionType === TRANSACTION_TYPES.expense">
                {{ $t('dialogs.manageTransaction.refundRecordsList.noExpenseTransactions') }}
              </template>
              <template v-else>
                {{ $t('dialogs.manageTransaction.refundRecordsList.noTransactions') }}
              </template>
            </p>

            <template v-if="isSearchActive">
              <Button class="w-auto" variant="secondary" @click="searchQuery = ''">
                {{ $t('dialogs.manageTransaction.refundRecordsList.clearSearchButton') }}
              </Button>
            </template>
            <template v-else-if="isAnyFiltersApplied">
              <Button class="w-auto" variant="secondary" @click="resetFilters">
                {{ $t('dialogs.manageTransaction.refundRecordsList.resetFiltersButton') }}
              </Button>
            </template>
          </div>
        </template>
      </div>
    </ScrollArea>
  </div>
</template>
