<script setup lang="ts">
import { deleteTransaction, loadTransactions } from '@/api/transactions';
import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { NotificationType, useNotificationCenter } from '@/components/notification-center';
import { useFormatCurrency } from '@/composable';
import { captureException } from '@/lib/sentry';
import { FILTER_OPERATION, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { ArrowDownRightIcon, ArrowUpRightIcon, HistoryIcon, Trash2Icon } from '@lucide/vue';
import { format, parseISO } from 'date-fns';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const REVALUATION_HISTORY_LIMIT = 100;

const props = defineProps<{ accountId: string; currencyCode: string }>();

const { t } = useI18n();
const queryClient = useQueryClient();
const { addNotification } = useNotificationCenter();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const queryKey = computed(() => [...VUE_QUERY_CACHE_KEYS.propertyRevaluationHistory, props.accountId]);

const { data, isLoading } = useQuery({
  queryKey,
  queryFn: () =>
    loadTransactions({
      accountIds: [props.accountId],
      transferFilter: FILTER_OPERATION.only,
      limit: REVALUATION_HISTORY_LIMIT,
      offset: 0,
    }),
});

const revaluations = computed(() =>
  (data.value ?? []).filter((tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet),
);

const txToDelete = ref<string | null>(null);

const deleteMutation = useMutation({
  mutationFn: (id: string) => deleteTransaction(id),
});

const confirmDelete = async () => {
  if (!txToDelete.value) return;
  const id = txToDelete.value;
  txToDelete.value = null;

  try {
    await deleteMutation.mutateAsync(id);
    addNotification({
      text: t('pages.propertyDetails.revaluationHistory.deleteSuccess'),
      type: NotificationType.success,
    });
    // Property cache keys are prefixed with `transactionChange`, so this single
    // predicate invalidation also covers propertyRevaluationHistory /
    // propertyDetail / propertiesList — no per-key invalidations needed.
    queryClient.invalidateQueries({
      predicate: (q) => (q.queryKey as string[]).includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange),
    });
  } catch (error) {
    addNotification({
      text: t('pages.propertyDetails.revaluationHistory.deleteError'),
      type: NotificationType.error,
    });
    captureException({ error, context: { source: 'propertyRevaluationHistoryDelete', transactionId: id } });
  }
};
</script>

<template>
  <div class="bg-card rounded-2xl border p-5 shadow-xs">
    <div class="mb-4 flex items-center gap-2">
      <HistoryIcon class="text-muted-foreground size-4" />
      <h3 class="text-sm font-semibold tracking-tight">
        {{ $t('pages.propertyDetails.revaluationHistory.title') }}
      </h3>
    </div>

    <div v-if="isLoading" class="bg-muted/30 h-16 animate-pulse rounded-lg"></div>

    <p v-else-if="revaluations.length === 0" class="text-muted-foreground py-2 text-sm">
      {{ $t('pages.propertyDetails.revaluationHistory.empty') }}
    </p>

    <ul v-else class="divide-border grid divide-y">
      <li
        v-for="tx in revaluations"
        :key="tx.id"
        class="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
      >
        <div class="flex min-w-0 items-center gap-3">
          <span
            class="bg-muted/40 flex size-8 shrink-0 items-center justify-center rounded-full"
            :class="
              tx.transactionType === TRANSACTION_TYPES.income ? 'text-app-income-color' : 'text-app-expense-color'
            "
          >
            <component
              :is="tx.transactionType === TRANSACTION_TYPES.income ? ArrowUpRightIcon : ArrowDownRightIcon"
              class="size-4"
            />
          </span>
          <div class="min-w-0">
            <div class="text-foreground text-sm font-medium tabular-nums">
              <span
                :class="
                  tx.transactionType === TRANSACTION_TYPES.income ? 'text-app-income-color' : 'text-app-expense-color'
                "
              >
                {{ tx.transactionType === TRANSACTION_TYPES.income ? '+' : '−' }}
                {{ formatAmountByCurrencyCode(tx.amount, currencyCode) }}
              </span>
            </div>
            <div class="text-muted-foreground truncate text-xs">
              {{ format(parseISO(String(tx.time)), 'MMM d, yyyy') }}
              <span v-if="tx.note">· {{ tx.note }}</span>
            </div>
          </div>
        </div>

        <DesktopOnlyTooltip :content="$t('pages.propertyDetails.revaluationHistory.delete')">
          <UiButton
            variant="ghost-destructive"
            size="icon-sm"
            :disabled="deleteMutation.isPending.value"
            @click="txToDelete = tx.id"
          >
            <Trash2Icon class="size-4" />
          </UiButton>
        </DesktopOnlyTooltip>
      </li>
    </ul>

    <ResponsiveAlertDialog
      :open="txToDelete !== null"
      :confirm-label="$t('pages.propertyDetails.revaluationHistory.deleteConfirm')"
      confirm-variant="destructive"
      @update:open="(val) => (val ? null : (txToDelete = null))"
      @confirm="confirmDelete"
    >
      <template #title>{{ $t('pages.propertyDetails.revaluationHistory.deleteTitle') }}</template>
      <template #description>{{ $t('pages.propertyDetails.revaluationHistory.deleteDescription') }}</template>
    </ResponsiveAlertDialog>
  </div>
</template>
