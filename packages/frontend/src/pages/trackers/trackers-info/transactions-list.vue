<script setup lang="ts">
import { addTransactionsToTracker, removeTransactionsFromTracker } from '@/api/trackers';
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
import { useScrollAreaContainer } from '@/composable/scroll-area-container';
import { useTrackerAccess } from '@/composable/use-tracker-access';
import { useShiftMultiSelect } from '@/composable/shift-multi-select';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import { TRACKER_STATUSES, type TrackerModel } from '@bt/shared/types';
import { PlusIcon, TableIcon, TargetIcon } from '@lucide/vue';
import { useMutation } from '@tanstack/vue-query';
import { useResizeObserver } from '@vueuse/core';
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

const props = defineProps<{ tracker: TrackerModel; canWrite: boolean }>();
const emit = defineEmits<{ openSettings: [] }>();
const reviewOpen = defineModel<boolean>('reviewOpen', { default: false });

const ROW_HEIGHT_PX = 40;
const SKELETON_ROWS = 8;

const { t } = useI18n();
const invalidateTracker = useInvalidateTracker();
const { addNotification, addSuccessNotification } = useNotificationCenter();
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const trackerId = computed(() => String(props.tracker.id));
const { isOwner } = useTrackerAccess(toRef(() => props.tracker));

const { data: suggestions } = useTrackerSuggestions({ trackerId, enabled: isOwner });
const aiMatchReasonByTxId = computed(
  () => new Map((suggestions.value?.aiMatched ?? []).map((match) => [match.transactionId, match.reason])),
);

const router = useRouter();
const openInTransactions = () =>
  router.push({ name: ROUTES_NAMES.transactions, query: { trackerIds: trackerId.value } });

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
  appendQueryKey: [...VUE_QUERY_CACHE_KEYS.trackerAddingTransactionList, trackerId],
  staticFilters: { trackerIds: [trackerId.value] },
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
    addTransactionsToTracker({ trackerId: trackerId.value, payload: { transactionIds } }),
  onSuccess: () => invalidateTracker({ trackerId: trackerId.value }),
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'budgets.smartTracking.relinkError',
      context: { source: 'trackerRelinkTransactions', trackerId: trackerId.value },
    }),
});

const { isPending: isUnlinking, mutate: unlinkTransactions } = useMutation({
  mutationFn: removeTransactionsFromTracker,
  onSuccess: (_data, { payload: { transactionIds } }) => {
    if (isOwner.value && (props.tracker.aiEnabled || props.tracker.rulesEnabled)) {
      addNotification({
        text: t(
          props.tracker.rulesEnabled ? 'budgets.rules.unlinked' : 'budgets.smartTracking.unlinked',
          { count: transactionIds.length },
          transactionIds.length,
        ),
        type: NotificationType.success,
        action: { label: t('budgets.smartTracking.undo'), onClick: () => relink.mutate({ transactionIds }) },
      });
    } else {
      addSuccessNotification(t('budgets.list.unlinkTransactionsSuccess'));
    }
    resetSelection();
    return invalidateTracker({ trackerId: trackerId.value });
  },
  onError: (error) =>
    reportTrackerError({
      error,
      fallbackKey: 'pages.budgets.transactionsList.unlinkError',
      context: { source: 'trackerUnlinkTransactions', trackerId: trackerId.value },
    }),
});

const isSelecting = computed(() => props.canWrite && pickedTransactionsIds.size > 0);

const handleUnlink = () =>
  unlinkTransactions({
    trackerId: trackerId.value,
    payload: { transactionIds: [...pickedTransactionsIds] },
  });
</script>

<template>
  <div class="@container/tracker-tx">
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
          <RecordsFiltersDialog v-model:open="isFiltersDialogOpen" size="sm" :isAnyFiltersApplied="isAnyFiltersApplied">
            <div class="relative max-h-[calc(100vh-var(--header-height)-32px)] overflow-auto">
              <RecordsFilters
                v-model:filters="filters"
                hide-trackers
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
            <span class="hidden @lg/tracker-tx:inline">{{ $t('pages.budgets.transactionsList.addTransactions') }}</span>
            <span class="@lg/tracker-tx:hidden">{{ $t('pages.budgets.transactionsList.add') }}</span>
          </Button>
        </AddTransactionsDialog>
      </template>
    </div>

    <div v-if="isOwner && tracker.status !== TRACKER_STATUSES.archived" ref="stripRef">
      <SmartTrackingStrip
        v-model:review-open="reviewOpen"
        :tracker="tracker"
        :suggestions="suggestions"
        @open-settings="emit('openSettings')"
      />
    </div>

    <div class="p-2 @md/tracker-tx:p-3">
      <div v-if="isInitialLoading" class="space-y-1">
        <TransactionRecordSkeleton v-for="i in SKELETON_ROWS" :key="i" compact />
      </div>

      <ErrorState v-else-if="isError" :message="$t('pages.budgets.transactionsList.loadError')" @retry="invalidate()" />

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
  </div>
</template>
