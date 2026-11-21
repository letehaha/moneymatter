<script setup lang="ts">
import { type LoanApi } from '@/api/loans';
import { isLoanPaymentPreAnchor } from '@/common/utils/loan-payment';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { Checkbox } from '@/components/lib/ui/checkbox';
import RecordsFiltersDialog from '@/components/records-filters/filters-dialog.vue';
import RecordsFilters from '@/components/records-filters/index.vue';
import { useTransactionsWithFilters } from '@/components/records-filters/transactions-with-filters';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { useLinkLoanPayments } from '@/composable/data-queries/loans';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { useShiftMultiSelect } from '@/composable/shift-multi-select';
import { useVirtualizedInfiniteScroll } from '@/composable/virtualized-infinite-scroll';
import { CUSTOM_BREAKPOINTS } from '@/composable/window-breakpoints';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { isApiErrorWithCode } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { API_ERROR_CODES, type LoanPaymentOverpayDetails, FILTER_OPERATION, TRANSACTION_TYPES } from '@bt/shared/types';
import { SearchXIcon } from '@lucide/vue';
import { parseISO } from 'date-fns';
import { useElementSize } from '@vueuse/core';
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ open: boolean; loan: LoanApi }>();
const emit = defineEmits<{ 'update:open': [value: boolean] }>();

const { t } = useI18n();
const { addNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();
const linkMutation = useLinkLoanPayments();

const isOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const pickedTransactionsIds = reactive<Set<string>>(new Set());
const { handleSelection, resetSelection, isShiftKeyPressed } = useShiftMultiSelect(pickedTransactionsIds);
const isTransactionsPicked = computed(() => pickedTransactionsIds.size > 0);

const isOverpayConfirmOpen = ref(false);
const overpayDetails = ref<LoanPaymentOverpayDetails | null>(null);

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
  isFetched,
} = useTransactionsWithFilters({
  appendQueryKey: [computed(() => props.loan.id)],
  queryEnabled: computed(() => props.open),
  // Default to outgoing non-transfer money since the loan's origination — the natural pool of
  // payments to attach. Widenable in the filter panel.
  staticFilters: {
    transactionType: TRANSACTION_TYPES.expense,
    transferFilter: FILTER_OPERATION.exclude,
    start: parseISO(props.loan.loanDetails.startDate),
  },
});

const scrollAreaRef = ref<InstanceType<typeof ScrollArea> | null>(null);
const parentRef = computed<HTMLElement | null>(() => scrollAreaRef.value?.viewportRef?.viewportElement ?? null);
const flatTransactions = computed(() => transactionsPages.value?.pages?.flat() ?? []);
const isListEmpty = computed(() => isFetched.value && flatTransactions.value.length === 0);

const { format: formatDate } = useDateLocale();

// Payments dated before the balance anchor link as history only — the anchor
// snapshot already includes them, so they never reduce the outstanding balance.
// Warn upfront instead of letting the link silently "do nothing".
const preAnchorPickedCount = computed(() => {
  const anchorDate = props.loan.loanDetails.balanceAnchorDate;
  return flatTransactions.value.filter(
    (tx) =>
      pickedTransactionsIds.has(tx.id) &&
      isLoanPaymentPreAnchor({ paymentDate: tx.time, balanceAnchorDate: anchorDate }),
  ).length;
});

const anchorDateDisplay = computed(() => formatDate(parseISO(props.loan.loanDetails.balanceAnchorDate), 'MMM d, yyyy'));

const { virtualRows, totalSize } = useVirtualizedInfiniteScroll({
  items: flatTransactions,
  hasNextPage: hasNextTransactionsPage,
  fetchNextPage: fetchNextTransactionPage,
  isFetchingNextPage: isFetchingNextTransactionsPage,
  parentRef,
  enabled: computed(() => props.open),
  getItemKey: (index) => flatTransactions.value[index]!.id,
});

const isFiltersDialogOpen = ref(false);
watch(appliedFilters, () => {
  isFiltersDialogOpen.value = false;
});

const contentWrapperRef = ref<HTMLElement | null>(null);
const { width: contentWrapperWidth } = useElementSize(contentWrapperRef);
const isMobileView = computed(() => contentWrapperWidth.value <= CUSTOM_BREAKPOINTS.uiDesktop);

const performLink = async (confirmOverpay = false) => {
  const transactionIds = [...pickedTransactionsIds.values()];
  if (transactionIds.length === 0) return;

  try {
    const { linkedCount } = await linkMutation.mutateAsync({ id: props.loan.id, transactionIds, confirmOverpay });
    addNotification({
      text: t('loans.linkPayments.success', { count: linkedCount }, linkedCount),
      type: NotificationType.success,
    });
    isOverpayConfirmOpen.value = false;
    isOpen.value = false;
  } catch (error) {
    // The batch overshoots the owed balance. Surface the overshoot and let the
    // user confirm (FX rounding shouldn't hard-block linking real payments).
    if (isApiErrorWithCode(error, API_ERROR_CODES.loanPaymentOverpayConfirmationRequired)) {
      overpayDetails.value = (error.data.details as unknown as LoanPaymentOverpayDetails) ?? null;
      isOverpayConfirmOpen.value = true;
      return;
    }
    // A plain validation rejection (e.g. a stale selection) already carries a
    // localised message; show it. Anything else is unexpected → report it.
    if (isApiErrorWithCode(error, API_ERROR_CODES.validationError) && error.data?.message) {
      addNotification({ text: error.data.message, type: NotificationType.error });
    } else {
      addNotification({ text: t('loans.linkPayments.error'), type: NotificationType.error });
      captureException({ error, context: { source: 'loanLinkPayments' } });
    }
  }
};

const overpayAmountDisplay = computed(() =>
  overpayDetails.value
    ? formatAmountByCurrencyCode({ amount: overpayDetails.value.overpayBy, currencyCode: props.loan.currencyCode })
    : '',
);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      resetSelection();
      isOverpayConfirmOpen.value = false;
      overpayDetails.value = null;
    }
  },
);
</script>

<template>
  <ResponsiveDialog v-model:open="isOpen" dialog-content-class="max-w-[900px] h-[85vh]" no-internal-scroll>
    <template #title>{{ $t('loans.linkPayments.title') }}</template>
    <template #description>{{ $t('loans.linkPayments.description') }}</template>

    <div
      ref="contentWrapperRef"
      class="grid min-h-0 flex-1 grid-cols-1 gap-4"
      :class="{ 'grid-cols-[max-content_minmax(0,1fr)]': !isMobileView }"
    >
      <ScrollArea class="relative min-h-0 px-1">
        <template v-if="isMobileView">
          <RecordsFiltersDialog v-model:open="isFiltersDialogOpen" :is-any-filters-applied="isAnyFiltersApplied">
            <ScrollArea class="relative max-h-[calc(100vh-var(--header-height)-32px)]">
              <RecordsFilters
                v-model:filters="filters"
                :is-reset-button-disabled="isResetButtonDisabled"
                :is-filters-out-of-sync="isFiltersOutOfSync"
                @reset-filters="resetFilters"
                @apply-filters="applyFilters"
              />
            </ScrollArea>
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
      </ScrollArea>

      <div class="flex min-h-0 flex-col">
        <div class="mb-3 flex items-center gap-2 border-b pb-3">
          <span class="text-muted-foreground mr-auto text-sm">
            {{ $t('loans.linkPayments.selectedCount', { count: pickedTransactionsIds.size }) }}
          </span>
          <Button type="button" size="sm" variant="outline" :disabled="!isTransactionsPicked" @click="resetSelection">
            {{ $t('loans.linkPayments.clearSelection') }}
          </Button>
          <Button
            type="button"
            size="sm"
            :disabled="!isTransactionsPicked || linkMutation.isPending.value"
            :loading="linkMutation.isPending.value"
            @click="performLink()"
          >
            {{ $t('loans.linkPayments.linkSelected', { count: pickedTransactionsIds.size }) }}
          </Button>
        </div>

        <Callout v-if="preAnchorPickedCount > 0" class="mb-3 text-xs">
          {{
            $t(
              'loans.linkPayments.preAnchorWarning',
              { count: preAnchorPickedCount, date: anchorDateDisplay },
              preAnchorPickedCount,
            )
          }}
        </Callout>

        <div v-if="isListEmpty" class="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
          <SearchXIcon class="text-muted-foreground size-8" />
          <p class="font-medium">{{ $t('loans.linkPayments.emptyTitle') }}</p>
          <p class="text-muted-foreground max-w-xs text-sm">{{ $t('loans.linkPayments.emptyDescription') }}</p>
        </div>

        <ScrollArea v-else-if="transactionsPages" ref="scrollAreaRef" class="min-h-0 flex-1" viewport-class="h-full">
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
                  'grid cursor-pointer grid-cols-[min-content_minmax(0,1fr)] items-center gap-2 pr-3',
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
              <div v-else class="flex h-13 items-center justify-center">{{ $t('transactions.list.loadingMore') }}</div>
            </div>
          </div>
          <template v-if="!hasNextTransactionsPage">
            <p class="text-muted-foreground flex justify-center text-sm">{{ $t('transactions.list.noMoreData') }}</p>
          </template>
        </ScrollArea>
      </div>
    </div>
  </ResponsiveDialog>

  <ResponsiveAlertDialog
    v-model:open="isOverpayConfirmOpen"
    :confirm-label="$t('loans.linkPayments.overpayConfirmButton')"
    :confirm-disabled="linkMutation.isPending.value"
    confirm-variant="destructive"
    @confirm="performLink(true)"
  >
    <template #title>{{ $t('loans.linkPayments.overpayTitle') }}</template>
    <template #description>
      {{ $t('loans.linkPayments.overpayDescription', { amount: overpayAmountDisplay }) }}
    </template>
  </ResponsiveAlertDialog>
</template>
