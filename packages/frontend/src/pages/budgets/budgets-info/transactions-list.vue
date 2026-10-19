<script setup lang="ts">
import { addTransactionsToBudget, loadCategoryBudgetTransactions, removeTransactionsFromBudget } from '@/api/budgets';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { SCROLL_AREA_IDS } from '@/components/lib/ui/scroll-area/types';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import RecordsFiltersDialog from '@/components/records-filters/filters-dialog.vue';
import RecordsFilters from '@/components/records-filters/index.vue';
import { useTransactionsWithFilters } from '@/components/records-filters/transactions-with-filters';
import TransactionDetailsModal from '@/components/transactions-list/transaction-details-modal.vue';
import TransactionRecordSkeleton from '@/components/transactions-list/transaction-record-skeleton.vue';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import ErrorState from '@/components/widgets/components/error-state.vue';
import { useManageTransactionDialog } from '@/components/transactions-list/use-manage-transaction-dialog';
import { useFormatCurrency } from '@/composable';
import { useScrollAreaContainer } from '@/composable/scroll-area-container';
import { useBudgetAccess } from '@/composable/use-budget-access';
import { useShiftMultiSelect } from '@/composable/shift-multi-select';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { BUDGET_STATUSES, BUDGET_TYPES, type BudgetModel } from '@bt/shared/types';
import { LayersIcon, Loader2Icon, PlusIcon, TableIcon, TargetIcon } from '@lucide/vue';
import { useInfiniteQuery, useMutation } from '@tanstack/vue-query';
import { useIntersectionObserver, useResizeObserver } from '@vueuse/core';
import { format, parseISO } from 'date-fns';
import { computed, defineAsyncComponent, reactive, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { reportTrackerError, useInvalidateTracker } from '../components/use-tracker-actions';
import AddTransactionsDialog from './add-transactions-dialog.vue';
import SelectionActions from './selection-actions.vue';
import SmartTrackingStrip from './smart-tracking/smart-tracking-strip.vue';
import { useTrackerSuggestions } from './smart-tracking/use-tracker-suggestions';

const ManageTransactionDialogContent = defineAsyncComponent(
  () => import('@/components/dialogs/manage-transaction/dialog-content.vue'),
);
const LoanPaymentDialog = defineAsyncComponent(() => import('@/pages/loans/components/loan-payment-dialog/index.vue'));

const props = defineProps<{ budget: BudgetModel; canWrite: boolean }>();
const emit = defineEmits<{ openSettings: [] }>();
const reviewOpen = defineModel<boolean>('reviewOpen', { default: false });

const ROW_HEIGHT_PX = 40;
const SKELETON_ROWS = 8;
const CATEGORY_PAGE_SIZE = 50;

const { t } = useI18n();
const invalidateTracker = useInvalidateTracker();
const { addNotification, addSuccessNotification } = useNotificationCenter();
const { formatBaseCurrency } = useFormatCurrency();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const budgetId = computed(() => String(props.budget.id));
const isManual = computed(() => props.budget.type === BUDGET_TYPES.manual);
const isCategory = computed(() => props.budget.type === BUDGET_TYPES.category);
const { isOwner } = useBudgetAccess(toRef(() => props.budget));
const hasSmartTracking = computed(() => isManual.value && isOwner.value);

const { data: suggestions } = useTrackerSuggestions({ budgetId, enabled: hasSmartTracking });
const aiMatchReasonByTxId = computed(
  () => new Map((suggestions.value?.aiMatched ?? []).map((match) => [match.transactionId, match.reason])),
);

const router = useRouter();
// Category trackers derive their rows from categories and dates, so they have no junction rows to link to.
const openInTransactions = () => {
  const query = isCategory.value
    ? {
        categoryIds: (props.budget.categories ?? []).map((category) => category.id),
        start: props.budget.startDate ? String(props.budget.startDate) : undefined,
        end: props.budget.endDate ? String(props.budget.endDate) : undefined,
      }
    : { budgetIds: budgetId.value };
  router.push({ name: ROUTES_NAMES.transactions, query });
};

const {
  isResetButtonDisabled,
  isFiltersOutOfSync,
  resetFilters,
  applyFilters,
  appliedFilters,
  isAnyFiltersApplied,
  filters,
  transactionsPages,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  isFetched,
  isFetching,
  isError,
  invalidate,
} = useTransactionsWithFilters({
  appendQueryKey: [...VUE_QUERY_CACHE_KEYS.budgetAddingTransactionList, budgetId],
  staticFilters: { budgetIds: [budgetId.value] },
  queryEnabled: isManual,
});

const flatTransactions = computed(() => transactionsPages.value?.pages?.flat() ?? []);
const isInitialLoading = computed(() => !isFetched.value || (isFetching.value && flatTransactions.value.length === 0));

const pickedTransactionsIds = reactive<Set<string>>(new Set());
const { handleSelection, resetSelection, isShiftKeyPressed } = useShiftMultiSelect(pickedTransactionsIds);
const isAllSelected = computed(
  () => flatTransactions.value.length > 0 && flatTransactions.value.every((tx) => pickedTransactionsIds.has(tx.id)),
);
const toggleSelectAll = () => {
  if (isAllSelected.value) resetSelection();
  else flatTransactions.value.forEach((tx) => pickedTransactionsIds.add(tx.id));
};
const onRowSelectionChange = ({ value, index }: { value: boolean; index: number }) => {
  const tx = flatTransactions.value[index];
  if (tx) handleSelection(value, tx.id, index, flatTransactions.value, (item) => item.id);
};

const isFiltersDialogOpen = ref(false);
watch(appliedFilters, () => {
  isFiltersDialogOpen.value = false;
  resetSelection();
});

const scrollContainer = useScrollAreaContainer(SCROLL_AREA_IDS.dashboard);
const scrollElement = computed<HTMLElement | null>(() => scrollContainer.value?.viewportElement ?? null);
const listRef = ref<HTMLElement | null>(null);
const stripRef = ref<HTMLElement | null>(null);
const scrollMargin = ref(0);
const measureScrollMargin = () => {
  const el = listRef.value;
  const scrollEl = scrollElement.value;
  if (el && scrollEl) {
    scrollMargin.value = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
  }
};
watch(listRef, measureScrollMargin);
useResizeObserver(stripRef, measureScrollMargin);

const { virtualRows, totalSize } = useVirtualizedInfiniteScroll({
  items: flatTransactions,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  parentRef: scrollElement,
  scrollMargin,
  enabled: isManual,
  estimateSize: () => ROW_HEIGHT_PX,
  getItemKey: (index) => flatTransactions.value[index]?.id ?? `loader-${index}`,
});

const {
  isDialogVisible,
  dialogProps,
  isCompactDialog,
  handleRecordClick,
  closeDialog,
  isLoanDialogVisible,
  loanDialogProps,
  closeLoanDialog,
} = useManageTransactionDialog();

const relink = useMutation({
  mutationFn: ({ transactionIds }: { transactionIds: string[] }) =>
    addTransactionsToBudget(budgetId.value, { transactionIds }),
  onSuccess: () => invalidateTracker({ budgetId: budgetId.value }),
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'budgets.smartTracking.relinkError',
      context: { source: 'trackerRelinkTransactions', budgetId: budgetId.value },
    }),
});

const { isPending: isUnlinking, mutate: unlinkTransactions } = useMutation({
  mutationFn: removeTransactionsFromBudget,
  onSuccess: (_data, { payload: { transactionIds } }) => {
    if (hasSmartTracking.value && props.budget.aiEnabled) {
      addNotification({
        text: t('budgets.smartTracking.unlinked', { count: transactionIds.length }, transactionIds.length),
        type: NotificationType.success,
        action: { label: t('budgets.smartTracking.undo'), onClick: () => relink.mutate({ transactionIds }) },
      });
    } else {
      addSuccessNotification(t('budgets.list.unlinkTransactionsSuccess'));
    }
    resetSelection();
    return invalidateTracker({ budgetId: budgetId.value });
  },
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'pages.budgets.transactionsList.unlinkError',
      context: { source: 'trackerUnlinkTransactions', budgetId: budgetId.value },
    }),
});

const isSelecting = computed(() => props.canWrite && pickedTransactionsIds.size > 0);

const handleUnlink = () =>
  unlinkTransactions({
    budgetId: budgetId.value,
    payload: { transactionIds: [...pickedTransactionsIds] },
  });

const {
  data: categoryTransactionsData,
  isLoading: isLoadingCategoryTransactions,
  isError: isCategoryTransactionsError,
  hasNextPage: hasNextCategoryPage,
  isFetchingNextPage: isFetchingNextCategoryPage,
  fetchNextPage: fetchNextCategoryPage,
} = useInfiniteQuery({
  queryFn: ({ pageParam }) =>
    loadCategoryBudgetTransactions({ budgetId: budgetId.value, from: pageParam, limit: CATEGORY_PAGE_SIZE }),
  queryKey: [...VUE_QUERY_CACHE_KEYS.budgetCategoryTransactions, budgetId],
  initialPageParam: 0,
  getNextPageParam: (lastPage, pages) => {
    const loaded = pages.reduce((count, page) => count + page.transactions.length, 0);
    return loaded < lastPage.total ? loaded : undefined;
  },
  staleTime: 30_000,
  enabled: isCategory,
});

const categoryTransactions = computed(
  () => categoryTransactionsData.value?.pages.flatMap((page) => page.transactions) ?? [],
);

const categorySentinelRef = ref<HTMLElement | null>(null);
useIntersectionObserver(categorySentinelRef, ([entry]) => {
  if (entry?.isIntersecting && hasNextCategoryPage.value && !isFetchingNextCategoryPage.value) fetchNextCategoryPage();
});

const formatTransactionDate = (date: string) => format(parseISO(date), 'MMM d, yyyy');
</script>

<template>
  <div class="@container/tracker-tx">
    <template v-if="isManual">
      <div
        :class="
          cn(
            'flex items-center justify-between gap-2 border-b px-3 py-2 @md/tracker-tx:px-4',
            !isMobile && 'bg-card/95 sticky top-[calc(var(--header-height)+2.25rem)] z-(--z-navbar) backdrop-blur',
          )
        "
      >
        <div v-if="!isMobile && isSelecting" class="flex flex-1 items-center gap-3">
          <SelectionActions
            :count="pickedTransactionsIds.size"
            :is-all-selected="isAllSelected"
            :is-unlinking="isUnlinking"
            @toggle-all="toggleSelectAll"
            @unlink="handleUnlink"
            @cancel="resetSelection"
          />
        </div>
        <template v-else>
          <div class="flex items-center gap-2">
            <RecordsFiltersDialog
              v-model:open="isFiltersDialogOpen"
              size="sm"
              :isAnyFiltersApplied="isAnyFiltersApplied"
            >
              <div class="relative max-h-[calc(100vh-var(--header-height)-32px)] overflow-auto">
                <RecordsFilters
                  v-model:filters="filters"
                  hide-budgets
                  :is-reset-button-disabled="isResetButtonDisabled"
                  :is-filters-out-of-sync="isFiltersOutOfSync"
                  @reset-filters="resetFilters"
                  @apply-filters="applyFilters"
                />
              </div>
            </RecordsFiltersDialog>
            <Button variant="outline" size="sm" @click="openInTransactions">
              <TableIcon class="size-4" />
              <span class="hidden @lg/tracker-tx:inline">{{ $t('budgets.details.actions.openInTransactions') }}</span>
            </Button>
          </div>

          <AddTransactionsDialog v-if="canWrite">
            <Button size="sm">
              <PlusIcon class="size-4" />
              <span class="hidden @lg/tracker-tx:inline">{{
                $t('pages.budgets.transactionsList.addTransactions')
              }}</span>
              <span class="@lg/tracker-tx:hidden">{{ $t('pages.budgets.transactionsList.add') }}</span>
            </Button>
          </AddTransactionsDialog>
        </template>
      </div>

      <div v-if="hasSmartTracking && budget.status !== BUDGET_STATUSES.archived" ref="stripRef">
        <SmartTrackingStrip
          v-model:review-open="reviewOpen"
          :budget="budget"
          :suggestions="suggestions"
          @open-settings="emit('openSettings')"
        />
      </div>

      <div class="p-2 @md/tracker-tx:p-3">
        <div v-if="isInitialLoading" class="space-y-1">
          <TransactionRecordSkeleton v-for="i in SKELETON_ROWS" :key="i" compact />
        </div>

        <ErrorState
          v-else-if="isError"
          :message="$t('pages.budgets.transactionsList.loadError')"
          @retry="invalidate()"
        />

        <div v-else-if="flatTransactions.length === 0" class="flex flex-col items-center py-12 text-center">
          <div class="bg-muted mb-4 flex size-14 items-center justify-center rounded-full">
            <TargetIcon class="text-muted-foreground size-7" />
          </div>
          <template v-if="isAnyFiltersApplied">
            <h3 class="mb-1 font-medium">{{ $t('pages.budgets.transactionsList.noMatchingTransactions') }}</h3>
            <p class="text-muted-foreground mb-4 max-w-sm text-sm">
              {{ $t('pages.budgets.transactionsList.filterAdjustmentHint') }}
            </p>
            <Button size="sm" variant="outline" @click="resetFilters">
              {{ $t('pages.budgets.transactionsList.resetFilters') }}
            </Button>
          </template>
          <template v-else>
            <h3 class="mb-1 font-medium">{{ $t('pages.budgets.transactionsList.noTransactionsLinked') }}</h3>
            <p class="text-muted-foreground mb-4 max-w-sm text-sm">
              {{ $t('pages.budgets.transactionsList.addTransactionsHint') }}
            </p>
            <AddTransactionsDialog v-if="canWrite">
              <Button size="sm">
                <PlusIcon class="size-4" />
                {{ $t('pages.budgets.transactionsList.addTransactions') }}
              </Button>
            </AddTransactionsDialog>
          </template>
        </div>

        <div v-else ref="listRef" class="relative" :style="{ height: `${totalSize}px` }">
          <div
            v-for="virtualRow in virtualRows"
            :key="String(virtualRow.key)"
            class="absolute top-0 left-0 flex w-full items-center"
            :style="{
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
            }"
          >
            <div
              v-if="flatTransactions[virtualRow.index]"
              :class="
                cn(
                  'w-full rounded-md',
                  isShiftKeyPressed && 'select-none',
                  pickedTransactionsIds.has(flatTransactions[virtualRow.index]!.id) && 'bg-primary/10',
                )
              "
            >
              <TransactionRecord
                :tx="flatTransactions[virtualRow.index]!"
                compact
                hide-refund-marker
                tags-variant="rails"
                :ai-match-reason="aiMatchReasonByTxId.get(flatTransactions[virtualRow.index]!.id)"
                :show-checkbox="canWrite"
                :is-selected="pickedTransactionsIds.has(flatTransactions[virtualRow.index]!.id)"
                :index="virtualRow.index"
                @record-click="handleRecordClick"
                @selection-change="onRowSelectionChange"
              />
            </div>
            <div v-else class="text-muted-foreground flex w-full justify-center text-sm">
              {{ $t('pages.budgets.transactionsList.loadingMore') }}
            </div>
          </div>
        </div>
      </div>

      <div
        v-if="isMobile && isSelecting"
        class="bg-popover/95 sticky bottom-3 z-10 mx-3 mb-3 flex items-center gap-3 rounded-lg border px-3 py-2 shadow-lg backdrop-blur"
      >
        <SelectionActions
          :count="pickedTransactionsIds.size"
          :is-all-selected="isAllSelected"
          :is-unlinking="isUnlinking"
          @toggle-all="toggleSelectAll"
          @unlink="handleUnlink"
          @cancel="resetSelection"
        />
      </div>

      <TransactionDetailsModal v-model:open="isDialogVisible" :mobile="isMobile" :is-compact="isCompactDialog">
        <ManageTransactionDialogContent v-bind="dialogProps" @close-modal="closeDialog" />
      </TransactionDetailsModal>
      <LoanPaymentDialog
        v-if="loanDialogProps.loanAccount"
        :open="isLoanDialogVisible"
        :loan-account="loanDialogProps.loanAccount"
        :transaction="loanDialogProps.transaction"
        :opposite-transaction="loanDialogProps.oppositeTransaction"
        @update:open="(value) => !value && closeLoanDialog()"
      />
    </template>

    <div v-else-if="isCategory" class="p-2 @md/tracker-tx:p-3">
      <div class="mb-2 flex justify-end">
        <Button variant="outline" size="sm" @click="openInTransactions">
          <TableIcon class="size-4" />
          {{ $t('budgets.details.actions.openInTransactions') }}
        </Button>
      </div>
      <div v-if="isLoadingCategoryTransactions" class="space-y-1">
        <TransactionRecordSkeleton v-for="i in SKELETON_ROWS" :key="i" compact />
      </div>

      <div v-else-if="isCategoryTransactionsError" class="text-destructive-text py-12 text-center text-sm">
        {{ $t('budgets.categoryBudget.transactionsLoadError') }}
      </div>

      <div v-else-if="categoryTransactions.length === 0" class="flex flex-col items-center py-12 text-center">
        <div class="bg-muted mb-4 flex size-14 items-center justify-center rounded-full">
          <LayersIcon class="text-muted-foreground size-7" />
        </div>
        <h3 class="mb-1 font-medium">{{ $t('budgets.categoryBudget.noTransactions') }}</h3>
        <p class="text-muted-foreground max-w-sm text-sm">
          {{ $t('budgets.categoryBudget.noTransactionsDescription') }}
        </p>
      </div>

      <template v-else>
        <div
          v-for="tx in categoryTransactions"
          :key="`${tx.id}-${tx.effectiveCategory?.id}`"
          class="hover:bg-muted/50 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-md px-2 py-2 transition-colors"
        >
          <span
            :class="cn('size-2.5 rounded-full', !tx.effectiveCategory && 'bg-muted-foreground/40')"
            :style="tx.effectiveCategory ? { backgroundColor: tx.effectiveCategory.color } : undefined"
          />
          <div class="min-w-0 truncate text-sm">
            <span v-if="tx.effectiveCategory">{{ tx.effectiveCategory.name }}</span>
            <span v-else class="text-muted-foreground">{{ $t('pages.budgetDetails.uncategorized') }}</span>
            <span class="text-muted-foreground">
              · {{ formatTransactionDate(tx.time) }}<template v-if="tx.note"> · {{ tx.note }}</template>
            </span>
          </div>
          <span
            :class="
              cn(
                'text-sm font-medium whitespace-nowrap tabular-nums',
                tx.transactionType === 'expense' ? 'text-app-expense-color' : 'text-app-income-color',
              )
            "
          >
            {{ tx.transactionType === 'expense' ? '-' : '+'
            }}{{ formatBaseCurrency(tx.effectiveRefAmount || tx.refAmount) }}
          </span>
        </div>

        <div v-if="hasNextCategoryPage" ref="categorySentinelRef" class="flex justify-center p-3">
          <Loader2Icon v-if="isFetchingNextCategoryPage" class="text-muted-foreground size-4 animate-spin" />
        </div>
      </template>
    </div>
  </div>
</template>
