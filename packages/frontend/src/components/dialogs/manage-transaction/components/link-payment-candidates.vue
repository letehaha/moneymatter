<script setup lang="ts">
import { loadTransactions } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { Button } from '@/components/lib/ui/button';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import RecordsFiltersDialog from '@/components/records-filters/filters-dialog.vue';
import RecordsFilters from '@/components/records-filters/index.vue';
import { useTransactionsWithFilters } from '@/components/records-filters/transactions-with-filters';
import TransactionRecordSkeleton from '@/components/transactions-list/transaction-record-skeleton.vue';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { useDateLocale } from '@/composable/use-date-locale';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { cn } from '@/lib/utils';
import {
  FILTER_OPERATION,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  type TransactionModel,
} from '@bt/shared/types';
import { CircleAlertIcon, LinkIcon, SparklesIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { createReusableTemplate, useResizeObserver } from '@vueuse/core';
import { addDays, endOfDay, startOfDay, subDays } from 'date-fns';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { PAYMENT_LINK_WINDOW_DAYS, hasPaymentParts } from '../utils/payment-legs';

const ROW_HEIGHT = 34;
const RECOMMENDED_LIMIT = 20;

const props = defineProps<{
  transactionType: TRANSACTION_TYPES;
  time: Date;
  excludeIds: string[];
  maxCount: number;
}>();

const { t } = useI18n();
const { format: formatDate } = useDateLocale();

interface Candidate {
  tx: TransactionModel;
  reason: string | undefined;
}

const [DefineRow, ReuseRow] = createReusableTemplate<{ item: Candidate }>();

const selected = ref<TransactionModel[]>([]);
const selectedIds = computed(() => new Set(selected.value.map((tx) => tx.id)));
const isLimitReached = computed(() => selected.value.length >= props.maxCount);

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
  isError,
  invalidate,
} = useTransactionsWithFilters({
  appendQueryKey: [...VUE_QUERY_CACHE_KEYS.paymentLinkCandidates],
  staticFilters: {
    transactionType: props.transactionType,
    transferFilter: FILTER_OPERATION.exclude,
    plannedFilter: FILTER_OPERATION.exclude,
  },
});

const {
  data: recommendedData,
  isPending: isRecommendedPending,
  isError: isRecommendedError,
  refetch: refetchRecommended,
} = useQuery({
  queryKey: computed(() => [
    ...VUE_QUERY_CACHE_KEYS.paymentLinkCandidates,
    'recommended',
    props.transactionType,
    props.time.getTime(),
  ]),
  queryFn: () =>
    loadTransactions({
      transactionType: props.transactionType,
      transferFilter: FILTER_OPERATION.exclude,
      isPlanned: false,
      from: startOfDay(subDays(props.time, PAYMENT_LINK_WINDOW_DAYS)).toISOString(),
      to: endOfDay(addDays(props.time, PAYMENT_LINK_WINDOW_DAYS)).toISOString(),
      includeSplits: true,
      limit: RECOMMENDED_LIMIT,
    }),
  enabled: computed(() => !isAnyFiltersApplied.value),
  staleTime: 1_000 * 60,
});

const blockReason = ({ tx }: { tx: TransactionModel }): string | undefined => {
  if (tx.transferNature !== TRANSACTION_TRANSFER_NATURE.not_transfer)
    return t('dialogs.manageTransaction.form.paymentLegs.linkPicker.transfer');
  if (tx.isPlanned) return t('dialogs.manageTransaction.form.paymentLegs.linkPicker.planned');
  if (tx.transactionType !== props.transactionType)
    return t('dialogs.manageTransaction.form.paymentLegs.linkPicker.differentType');
  if (tx.paymentParentId || hasPaymentParts({ transaction: tx }))
    return t('dialogs.manageTransaction.form.paymentLegs.linkPicker.inOtherPayment');
  if (tx.splits?.length) return t('dialogs.manageTransaction.form.paymentLegs.linkPicker.hasSplits');
  if (tx.refundLinked) return t('dialogs.manageTransaction.form.paymentLegs.linkPicker.refundLinked');
  if (tx.isPending) return t('dialogs.manageTransaction.form.paymentLegs.linkPicker.pending');
  return undefined;
};

const excludedIds = computed(() => new Set(props.excludeIds));

const toCandidates = ({ txs }: { txs: TransactionModel[] }): Candidate[] =>
  txs.filter((tx) => !excludedIds.value.has(tx.id)).map((tx) => ({ tx, reason: blockReason({ tx }) }));

const recommended = computed(() => toCandidates({ txs: recommendedData.value ?? [] }));
const isLoadError = computed(() => isError.value || (!isAnyFiltersApplied.value && isRecommendedError.value));
const isLoading = computed(
  () => !transactionsPages.value || (!isAnyFiltersApplied.value && isRecommendedPending.value),
);
const retry = () => {
  invalidate();
  refetchRecommended();
};
const showRecommendations = computed(() => !isAnyFiltersApplied.value && recommended.value.length > 0);
const recommendedIds = computed(() => new Set(recommended.value.map(({ tx }) => tx.id)));

const candidates = computed(() => {
  const all = toCandidates({ txs: transactionsPages.value?.pages.flat() ?? [] });
  if (!showRecommendations.value) return all;
  return all.filter(({ tx }) => !recommendedIds.value.has(tx.id));
});

const windowHint = computed(() =>
  t('dialogs.manageTransaction.form.paymentLegs.linkPicker.windowHint', {
    days: PAYMENT_LINK_WINDOW_DAYS,
    date: formatDate(props.time, 'd MMM'),
  }),
);

const toggle = ({ tx, reason }: Candidate) => {
  if (selectedIds.value.has(tx.id)) {
    selected.value = selected.value.filter((item) => item.id !== tx.id);
  } else if (!reason && !isLimitReached.value) {
    selected.value = [...selected.value, tx];
  }
};

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const parentRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);

// The recommended block scrolls with the list, so the virtualizer needs the
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
  items: candidates,
  hasNextPage,
  fetchNextPage,
  isFetchingNextPage,
  parentRef,
  scrollMargin,
  estimateSize: () => ROW_HEIGHT,
  getItemKey: (index) => candidates.value[index]?.tx.id ?? index,
});

const isFiltersDialogOpen = ref(false);
watch(appliedFilters, () => {
  isFiltersDialogOpen.value = false;
});

const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiDesktop);

defineExpose({ selected });
</script>

<template>
  <DefineRow v-slot="{ item }">
    <div
      :class="
        cn(
          'rounded-xl border border-transparent transition-colors',
          selectedIds.has(item.tx.id) && 'border-primary/70 bg-primary/10',
          item.reason && 'opacity-60',
        )
      "
    >
      <TransactionRecord
        :tx="item.tx"
        compact
        tags-variant="rails"
        show-checkbox
        :is-selected="selectedIds.has(item.tx.id)"
        :is-selectable="!item.reason && (!isLimitReached || selectedIds.has(item.tx.id))"
        :unselectable-hint="
          item.reason ??
          (isLimitReached ? $t('dialogs.manageTransaction.form.paymentLegs.linkPicker.limitReached') : undefined)
        "
        @record-click="toggle(item)"
        @selection-change="toggle(item)"
      />
    </div>
  </DefineRow>

  <!-- The row tracks need a definite height to scroll each column on its own: under a bare
       max-height an auto track grows to its content and the whole dialog scrolls instead. -->
  <div
    class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-[max-content_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]"
  >
    <ScrollArea class="relative min-h-0 px-1">
      <RecordsFiltersDialog
        v-if="isMobileView"
        v-model:open="isFiltersDialogOpen"
        :is-any-filters-applied="isAnyFiltersApplied"
      >
        <RecordsFilters
          v-model:filters="filters"
          :is-reset-button-disabled="isResetButtonDisabled"
          :is-filters-out-of-sync="isFiltersOutOfSync"
          @reset-filters="resetFilters"
          @apply-filters="applyFilters"
        />
      </RecordsFiltersDialog>
      <RecordsFilters
        v-else
        v-model:filters="filters"
        :is-reset-button-disabled="isResetButtonDisabled"
        :is-filters-out-of-sync="isFiltersOutOfSync"
        @reset-filters="resetFilters"
        @apply-filters="applyFilters"
      />
    </ScrollArea>

    <div class="flex min-h-0 flex-col">
      <div v-if="isLoadError" class="flex flex-col items-center py-8 text-center">
        <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
          <CircleAlertIcon class="text-destructive-text size-6" />
        </div>
        <h3 class="mb-4 font-semibold">{{ $t('dialogs.manageTransaction.form.paymentLegs.linkPicker.loadError') }}</h3>
        <Button type="button" variant="outline" @click="retry">{{ $t('common.actions.retry') }}</Button>
      </div>
      <div v-else-if="isLoading" class="space-y-1">
        <TransactionRecordSkeleton v-for="i in 6" :key="i" compact />
      </div>
      <div
        v-else-if="!showRecommendations && !candidates.length && !hasNextPage"
        class="flex flex-col items-center py-8 text-center"
      >
        <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
          <LinkIcon class="text-muted-foreground size-6" />
        </div>
        <h3 class="mb-2 text-lg font-semibold">
          {{ $t('dialogs.manageTransaction.form.paymentLegs.linkPicker.emptyTitle') }}
        </h3>
        <p class="text-muted-foreground mb-4 max-w-md text-sm">
          <template v-if="isAnyFiltersApplied">
            {{ $t('dialogs.manageTransaction.form.paymentLegs.linkPicker.emptyFilteredDescription') }}
          </template>
          <template v-else>
            {{ $t('dialogs.manageTransaction.form.paymentLegs.linkPicker.emptyDescription') }}
          </template>
        </p>
        <Button v-if="isAnyFiltersApplied" type="button" variant="secondary" @click="resetFilters">
          {{ $t('dialogs.manageTransaction.transferRecordsList.resetFiltersButton') }}
        </Button>
      </div>
      <ScrollArea v-else ref="scrollAreaRef" class="min-h-0 flex-1" viewport-class="h-full">
        <div ref="scrollContentRef">
          <template v-if="showRecommendations">
            <div class="mb-3">
              <div class="text-muted-foreground mb-2 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <span class="flex items-center gap-1.5 self-center font-medium">
                  <SparklesIcon class="size-3.5" />
                  {{ $t('dialogs.manageTransaction.transferRecordsList.recommendedLabel') }}
                </span>
                <span>{{ windowHint }}</span>
              </div>
              <div class="space-y-1">
                <ReuseRow v-for="item in recommended" :key="item.tx.id" :item="item" />
              </div>
            </div>

            <div v-if="candidates.length" class="text-muted-foreground mb-2 text-xs font-medium">
              {{ $t('dialogs.manageTransaction.transferRecordsList.allTransactionsLabel') }}
            </div>
          </template>

          <div ref="listContainerRef" :style="{ height: `${totalSize}px`, position: 'relative' }">
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
              <ReuseRow v-if="candidates[virtualRow.index]" :item="candidates[virtualRow.index]!" />
              <TransactionRecordSkeleton v-else compact />
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  </div>
</template>
