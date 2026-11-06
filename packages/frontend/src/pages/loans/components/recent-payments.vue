<template>
  <Card>
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between gap-2">
        <div class="text-base font-semibold">{{ $t('loans.detail.payments.title') }}</div>

        <ResponsiveDialog v-if="hasMorePayments" v-model:open="isAllPaymentsOpen" dialog-content-class="max-w-lg">
          <template #trigger>
            <Button variant="link" size="sm" class="text-muted-foreground h-auto p-0">
              {{ $t('loans.detail.payments.seeAll') }}
            </Button>
          </template>

          <template #title>{{ $t('loans.detail.payments.allTitle') }}</template>

          <ScrollArea class="max-h-[60dvh]">
            <div v-if="allPaymentsQuery.isLoading.value" class="space-y-2 py-2">
              <div v-for="i in 5" :key="i" class="flex items-center justify-between gap-3">
                <div class="bg-muted h-4 w-32 animate-pulse rounded" />
                <div class="bg-muted h-4 w-20 animate-pulse rounded" />
              </div>
            </div>

            <div v-else-if="allPaymentsQuery.error.value" class="text-destructive-text py-3 text-sm">
              {{ $t('loans.detail.payments.loadError') }}
            </div>

            <template v-else>
              <div class="space-y-1">
                <TransactionRecord
                  v-for="payment in allPayments"
                  :key="payment.id"
                  :tx="payment"
                  @record-click="handleRecordClick"
                />
              </div>

              <div v-if="allPaymentsQuery.hasNextPage.value" ref="sentinelRef" class="flex justify-center p-3">
                <Loader2Icon
                  v-if="allPaymentsQuery.isFetchingNextPage.value"
                  class="text-muted-foreground size-4 animate-spin"
                />
              </div>
            </template>
          </ScrollArea>
        </ResponsiveDialog>
      </div>
    </CardHeader>
    <CardContent>
      <div v-if="paymentsQuery.isLoading.value" class="space-y-2">
        <div v-for="i in 3" :key="i" class="flex items-center justify-between gap-3">
          <div class="bg-muted h-4 w-32 animate-pulse rounded" />
          <div class="bg-muted h-4 w-20 animate-pulse rounded" />
        </div>
      </div>

      <div v-else-if="paymentsQuery.error.value" class="text-destructive-text py-3 text-sm">
        {{ $t('loans.detail.payments.loadError') }}
      </div>

      <div v-else-if="!payments.length" class="text-muted-foreground py-6 text-center text-sm">
        {{ $t('loans.detail.payments.empty') }}
      </div>

      <div v-else class="space-y-1">
        <TransactionRecord
          v-for="payment in visiblePayments"
          :key="payment.id"
          :tx="payment"
          @record-click="handleRecordClick"
        />
      </div>
    </CardContent>
  </Card>

  <LoanPaymentDialog
    v-if="loanAccount && dialogTransaction && dialogOppositeTransaction"
    v-model:open="isDialogOpen"
    :loan-account="loanAccount"
    :transaction="dialogTransaction"
    :opposite-transaction="dialogOppositeTransaction"
  />
</template>

<script setup lang="ts">
import { loadTransactions, loadTransactionsByTransferId } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { type LoanApi } from '@/api/loans';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { Card, CardContent, CardHeader } from '@/components/lib/ui/card';
import { ScrollArea } from '@/components/lib/ui/scroll-area';
import { useNotificationCenter } from '@/components/notification-center';
import TransactionRecord from '@/components/transactions-list/transaction-record.vue';
import { captureException } from '@/lib/sentry';
import { useAccountsStore } from '@/stores';
import { TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { Loader2Icon } from '@lucide/vue';
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query';
import { useIntersectionObserver } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import LoanPaymentDialog from './loan-payment-dialog/index.vue';

const props = defineProps<{ loan: LoanApi }>();

// Card shows only the latest few so it stays the same height as its grid neighbors; full history
// lives in the "See all" dialog.
const VISIBLE_PAYMENTS_COUNT = 3;
// Fetched over-count: filters out non-income legs (interest, disbursements) below, plus needs one
// extra income leg to know whether to render "See all".
const RECENT_PAYMENTS_LIMIT = 10;
const ALL_PAYMENTS_PAGE_SIZE = 30;

const { t } = useI18n();
const { addErrorNotification } = useNotificationCenter();
const { accountsRecord } = storeToRefs(useAccountsStore());

const loanAccount = computed(() => accountsRecord.value[props.loan.id]);

const paymentsQuery = useQuery({
  // The `transactionChange` key prefix opts this into global invalidation from
  // use-submit-transaction / use-delete-transaction, so no manual refetch is needed.
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.loanRecentPayments, props.loan.id] as const),
  queryFn: () =>
    loadTransactions({
      offset: 0,
      limit: RECENT_PAYMENTS_LIMIT,
      accountIds: [props.loan.id],
    }),
  staleTime: 1000 * 60 * 5,
});

// Paid principal arrives as an income leg; interest charges and disbursements are negative legs —
// filter those out so the section reads as "money you sent against this loan".
const filterPayments = (txs: TransactionModel[]) => txs.filter((tx) => tx.transactionType === TRANSACTION_TYPES.income);

const payments = computed(() => filterPayments(paymentsQuery.data.value ?? []));
const visiblePayments = computed(() => payments.value.slice(0, VISIBLE_PAYMENTS_COUNT));
// More than the card shows, OR the raw page came back full — older income legs may exist past the
// fetch window even when the filtered count is small.
const hasMorePayments = computed(
  () =>
    payments.value.length > VISIBLE_PAYMENTS_COUNT || (paymentsQuery.data.value ?? []).length === RECENT_PAYMENTS_LIMIT,
);

const isAllPaymentsOpen = ref(false);

const allPaymentsQuery = useInfiniteQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.loanAllPayments, props.loan.id] as const),
  queryFn: ({ pageParam }) =>
    loadTransactions({
      offset: pageParam * ALL_PAYMENTS_PAGE_SIZE,
      limit: ALL_PAYMENTS_PAGE_SIZE,
      accountIds: [props.loan.id],
      transactionType: TRANSACTION_TYPES.income,
    }),
  initialPageParam: 0,
  getNextPageParam: (lastPage, pages) => (lastPage.length < ALL_PAYMENTS_PAGE_SIZE ? undefined : pages.length),
  // Don't fetch the full history until the user actually opens the dialog.
  enabled: isAllPaymentsOpen,
  staleTime: 1000 * 60 * 5,
});

const allPayments = computed(() => allPaymentsQuery.data.value?.pages.flat() ?? []);

const sentinelRef = ref<HTMLElement | null>(null);
useIntersectionObserver(sentinelRef, ([entry]) => {
  if (entry?.isIntersecting && allPaymentsQuery.hasNextPage.value && !allPaymentsQuery.isFetchingNextPage.value) {
    allPaymentsQuery.fetchNextPage();
  }
});

// Rows hold the loan-side (income) leg; the dialog also needs the source-side (expense) leg.
// TransactionRecord usually hands both along with the click — fetch by transferId only as a fallback.
const isDialogOpen = ref(false);
const dialogTransaction = ref<TransactionModel | null>(null);
const dialogOppositeTransaction = ref<TransactionModel | null>(null);

const openPaymentDialog = ({ sourceLeg, loanLeg }: { sourceLeg: TransactionModel; loanLeg: TransactionModel }) => {
  dialogTransaction.value = sourceLeg;
  dialogOppositeTransaction.value = loanLeg;
  isDialogOpen.value = true;
};

const handleRecordClick = async ([payment, oppositeTx]: [TransactionModel, TransactionModel | undefined]) => {
  if (oppositeTx) {
    openPaymentDialog({ sourceLeg: oppositeTx, loanLeg: payment });
    return;
  }

  // Orphaned leg: its pair was deleted and `transferId` cleared. There is no
  // source leg to edit through the loan dialog — tell the user instead of
  // letting the click silently do nothing.
  if (!payment.transferId) {
    addErrorNotification(t('loans.detail.payments.loadError'));
    return;
  }
  try {
    const legs = await loadTransactionsByTransferId(payment.transferId);
    const sourceLeg = legs?.find((leg) => leg.id !== payment.id);
    if (!sourceLeg) {
      addErrorNotification(t('loans.detail.payments.loadError'));
      return;
    }
    openPaymentDialog({ sourceLeg, loanLeg: payment });
  } catch (error) {
    captureException({ error, context: { source: 'loanRecentPayments', transferId: payment.transferId } });
    addErrorNotification(t('loans.detail.payments.loadError'));
  }
};
</script>
