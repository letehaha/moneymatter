<script lang="ts" setup>
import type { RefundRole } from '@/api/transactions';
import FieldLabel from '@/components/fields/components/field-label.vue';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { SplitIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { RefundWithSplit, RefundedByAnotherTxs, RefundsAnoterTx } from '../../types';
import { finalizeRefundShares, refillRefundSide } from '../../utils/refund-shares';
import LinkedTransactionRow from '../linked-transaction-row.vue';
import MarkAsRefundDialog from './mark-as-refund-dialog.vue';

const { t } = useI18n();

const props = defineProps<{
  transactionId: string | undefined;
  transactionType: TRANSACTION_TYPES;
  refunds: RefundsAnoterTx;
  refundedBy: RefundedByAnotherTxs;
  disabled?: boolean;
  isLoadFailed?: boolean;
  hasExternalLink?: boolean;
  isThereOriginalRefunds: boolean;
  isRecordCreation: boolean;
  /** Current form amount (live value from the form) */
  currentAmount?: number | null;
  /** Current form's currency code */
  currentCurrencyCode?: string;
  /** Current account ID (for recommendations) */
  currentAccountId?: string | null;
  /** Live form time; pivot for which side of a refund link the picked rows fall on. */
  currentTime: Date;
  /** This refund's saved same-currency share per `refundShareKey` target. */
  savedRefundShares?: Record<string, number>;
  isOverAssigned?: boolean;
}>();

const emit = defineEmits<{
  'update:refunds': [value: RefundsAnoterTx];
  'update:refundedBy': [value: RefundedByAnotherTxs];
}>();

const { categoriesMap } = storeToRefs(useCategoriesStore());
const { convert } = useExchangeRates();

const dialogRef = ref<InstanceType<typeof MarkAsRefundDialog> | null>(null);
defineExpose({ open: () => dialogRef.value?.open() });

// `null` marks an existing link as deliberately removed; `undefined` means "never had one".
const clearedValue = () => (props.isThereOriginalRefunds ? null : undefined);

const withoutRefund = ({
  list,
  removed,
  role,
}: {
  list: RefundWithSplit[];
  removed: RefundWithSplit;
  role: RefundRole;
}) => {
  const remaining = list.filter((item) => item.transaction.id !== removed.transaction.id);
  if (!remaining.length) return clearedValue();
  const refilled = refillRefundSide({
    links: remaining,
    role,
    amount: props.currentAmount,
    currencyCode: props.currentCurrencyCode,
    savedShares: props.savedRefundShares,
    convert,
  });
  return role === 'refund' ? finalizeRefundShares({ links: refilled, refundAmount: props.currentAmount }) : refilled;
};

const removeRefund = (removed: RefundWithSplit) => {
  if (props.refunds?.length) {
    emit('update:refunds', withoutRefund({ list: props.refunds, removed, role: 'refund' }));
    return;
  }
  emit('update:refundedBy', withoutRefund({ list: props.refundedBy ?? [], removed, role: 'original' }));
};

// The picker only ever reports the side it was saved in, so the opposite side has to be
// dropped here; otherwise reopening a linked row and switching mode submits both.
const onRefundsUpdate = (value: RefundsAnoterTx) => {
  emit('update:refunds', value?.length ? value : clearedValue());
  if (props.refundedBy) emit('update:refundedBy', clearedValue());
};

const onRefundedByUpdate = (value: RefundedByAnotherTxs) => {
  emit('update:refundedBy', value?.length ? value : clearedValue());
  if (props.refunds) emit('update:refunds', clearedValue());
};

const refundTransactions = computed<RefundWithSplit[]>(() => {
  if (props.refunds?.length) return props.refunds;
  if (props.refundedBy) return props.refundedBy;
  return [];
});

// An empty `refundedBy` array counts as unlinked, so the parent keeps offering its "Link refund" chip.
// A linked layout with zero rows would leave no way to open the picker or unlink.
const isLinked = computed(() => refundTransactions.value.length > 0);

// Get split category info for display
const getSplitInfo = (refund: RefundWithSplit) => {
  if (!refund.splitId) return null;

  // Find the split in the transaction
  const split = refund.transaction.splits?.find((s) => s.id === refund.splitId);
  if (!split) return null;

  const category = categoriesMap.value[split.categoryId];
  return {
    name: category?.name ?? t('common.labels.unknown'),
    color: category?.color ?? '#666',
    amount: split.amount,
  };
};
</script>

<template>
  <MarkAsRefundDialog
    ref="dialogRef"
    :key="transactionType"
    :refunds="refunds"
    :refunded-by="refundedBy"
    :transaction-type="transactionType"
    :is-record-creation="isRecordCreation"
    :current-amount="currentAmount"
    :current-currency-code="currentCurrencyCode"
    :current-account-id="currentAccountId"
    :current-time="currentTime"
    :current-transaction-id="transactionId"
    :has-external-link="hasExternalLink"
    :saved-refund-shares="savedRefundShares"
    @update:refunds="onRefundsUpdate"
    @update:refunded-by="onRefundedByUpdate"
  >
    <template v-if="isLinked" #trigger="{ open }">
      <FieldLabel :label="$t('dialogs.manageTransaction.markAsRefund.linkedRefunds')" only-template>
        <div class="flex flex-col gap-1.5">
          <div v-for="refund of refundTransactions" :key="refund.transaction.id" class="min-w-0">
            <LinkedTransactionRow
              selectable
              :transaction="refund.transaction"
              :disabled="disabled"
              :remove-label="$t('dialogs.manageTransaction.markAsRefund.unlinkRefund')"
              @select="open"
              @remove="removeRefund(refund)"
            />

            <template v-if="refund.splitId && getSplitInfo(refund)">
              <div class="border-border/50 bg-muted/20 mt-1 ml-4 flex items-center gap-2 rounded border px-2 py-1">
                <SplitIcon class="text-muted-foreground size-3" />
                <div class="size-2 shrink-0 rounded-full" :style="{ backgroundColor: getSplitInfo(refund)!.color }" />
                <span class="text-muted-foreground text-xs">
                  {{
                    $t('dialogs.manageTransaction.markAsRefund.refundsPortion', { name: getSplitInfo(refund)!.name })
                  }}
                </span>
              </div>
            </template>
            <p v-if="refund.amount === 0" class="text-muted-foreground mt-1 ml-4 text-sm">
              {{ $t('dialogs.manageTransaction.markAsRefund.notCoveredWillUnlink') }}
            </p>
          </div>
          <p v-if="isOverAssigned" class="text-destructive-text text-sm">
            {{ $t('dialogs.manageTransaction.markAsRefund.sharesOverRefund') }}
          </p>
        </div>
      </FieldLabel>
    </template>
    <template v-else-if="isLoadFailed || hasExternalLink" #trigger>
      <FieldLabel :label="$t('dialogs.manageTransaction.markAsRefund.linkedRefunds')" only-template>
        <p :class="cn('text-sm', isLoadFailed ? 'text-warning-text' : 'text-muted-foreground')">
          {{
            isLoadFailed
              ? $t('dialogs.manageTransaction.markAsRefund.loadFailed')
              : $t('dialogs.manageTransaction.markAsRefund.externalLink')
          }}
        </p>
      </FieldLabel>
    </template>
  </MarkAsRefundDialog>
</template>
