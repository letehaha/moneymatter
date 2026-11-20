<template>
  <ResponsiveDialog v-model:open="isOpen" :dialog-content-class="cn('max-h-[90dvh] w-full max-w-3xl p-6')">
    <template #title>
      <span class="text-lg font-semibold">{{ $t('payees.transactionsDialog.title', { name: payeeName ?? '' }) }}</span>
    </template>

    <div v-if="!payeeId" class="text-muted-foreground py-8 text-center text-sm">
      {{ $t('payees.transactionsDialog.empty') }}
    </div>
    <div v-else-if="isFetching && transactions.length === 0" class="text-muted-foreground py-8 text-center text-sm">
      {{ $t('common.loading') }}
    </div>
    <div v-else-if="transactions.length === 0" class="text-muted-foreground py-8 text-center text-sm">
      {{ $t('payees.transactionsDialog.empty') }}
    </div>
    <TransactionsList v-else :transactions="transactions" :paginate="false" raw-list disable-grouping>
      <template #row-trailing="{ tx }">
        <DesktopOnlyTooltip :content="$t('payees.transactionsDialog.unlink')">
          <Button
            variant="ghost-destructive"
            size="icon-sm"
            class="shrink-0"
            :aria-label="$t('payees.transactionsDialog.unlink')"
            @click.stop="requestUnlink({ txId: tx.id })"
          >
            <Link2OffIcon class="size-4" />
          </Button>
        </DesktopOnlyTooltip>
      </template>
    </TransactionsList>
  </ResponsiveDialog>

  <ResponsiveAlertDialog
    v-model:open="unlinkConfirm.isOpen"
    :confirm-label="$t('payees.transactionsDialog.unlinkConfirmLabel')"
    confirm-variant="destructive"
    @confirm="confirmUnlink"
  >
    <template #title>{{ $t('payees.transactionsDialog.unlinkConfirmTitle') }}</template>
    <template #description>
      {{ $t('payees.transactionsDialog.unlinkConfirmDescription', { name: payeeName ?? '' }) }}
    </template>
  </ResponsiveAlertDialog>
</template>

<script setup lang="ts">
import { editTransaction, loadTransactions } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useNotificationCenter } from '@/components/notification-center';
import TransactionsList from '@/components/transactions-list/transactions-list.vue';
import { invalidatePayeesScope } from '@/composable/data-queries/payees';
import { ApiErrorResponseError } from '@/js/errors';
import { captureException } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import type { TransactionModel } from '@bt/shared/types';
import { Link2OffIcon } from '@lucide/vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useVModel } from '@vueuse/core';
import { computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

const PAGE_SIZE = 500;
const STALE_TIME_MS = 60_000;

const props = defineProps<{
  open: boolean;
  payeeId: string | null;
  payeeName: string | null;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
}>();

const isOpen = useVModel(props, 'open', emit);

const { t } = useI18n();
const { addSuccessNotification, addErrorNotification } = useNotificationCenter();
const queryClient = useQueryClient();

const transactionsQueryKey = computed(
  () => [...VUE_QUERY_CACHE_KEYS.payeeTransactionsDialog, props.payeeId ?? 'none'] as const,
);

const { data, isFetching } = useQuery({
  queryKey: transactionsQueryKey,
  queryFn: () =>
    loadTransactions({
      offset: 0,
      limit: PAGE_SIZE,
      payeeIds: [props.payeeId!],
    }),
  enabled: computed(() => props.open && !!props.payeeId),
  staleTime: STALE_TIME_MS,
});

const transactions = computed(() => data.value ?? []);

// Clearing the link stamps `payeeLocked = true` on the row, so a later provider
// sync won't re-attach the Payee the user just detached.
const unlinkMut = useMutation({
  mutationFn: ({ txId }: { txId: string }) => editTransaction({ txId, payeeId: null }),
  onMutate: async ({ txId }) => {
    const queryKey = transactionsQueryKey.value;
    await queryClient.cancelQueries({ queryKey });
    const previous = queryClient.getQueryData<TransactionModel[]>(queryKey);
    queryClient.setQueryData<TransactionModel[]>(queryKey, (old) => old?.filter((tx) => tx.id !== txId));
    return { previous, queryKey };
  },
  onSuccess: () => {
    addSuccessNotification(t('payees.transactionsDialog.unlinked'));
  },
  onError: (error, _variables, context) => {
    if (context?.previous) {
      queryClient.setQueryData(context.queryKey, context.previous);
    }
    if (error instanceof ApiErrorResponseError) {
      addErrorNotification(error.data.message ?? t('payees.errors.generic'));
      return;
    }
    captureException({ error, context: { flow: 'unlinkTransactionFromPayee' } });
    addErrorNotification(t('payees.errors.generic'));
  },
  onSettled: () => {
    // The row drops out of every transaction-shaped list, and the Payee's stats
    // (tx count, net flow, top category) sit outside the transactionChange
    // scope, so both need refreshing.
    queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
    invalidatePayeesScope(queryClient);
  },
});

const unlinkConfirm = reactive({
  isOpen: false,
  transactionId: undefined as string | undefined,
});

const requestUnlink = ({ txId }: { txId: string }) => {
  unlinkConfirm.transactionId = txId;
  unlinkConfirm.isOpen = true;
};

const confirmUnlink = () => {
  if (!unlinkConfirm.transactionId) return;
  unlinkMut.mutate({ txId: unlinkConfirm.transactionId });
  unlinkConfirm.isOpen = false;
};
</script>
