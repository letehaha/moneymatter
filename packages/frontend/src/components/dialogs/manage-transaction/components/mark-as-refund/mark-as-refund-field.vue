<script lang="ts" setup>
import type { FormattedCategory } from '@/common/types';
import FieldLabel from '@/components/fields/components/field-label.vue';
import { useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES, TransactionSplitModel } from '@bt/shared/types';
import { SplitIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import { RefundWithSplit, RefundedByAnotherTxs, RefundsAnoterTx } from '../../types';
import LinkedTransactionRow from '../linked-transaction-row.vue';
import MarkAsRefundDialog from './mark-as-refund-dialog.vue';

const { t } = useI18n();

const props = defineProps<{
  transactionId: string | undefined;
  transactionType: TRANSACTION_TYPES;
  refunds: RefundsAnoterTx;
  refundedBy: RefundedByAnotherTxs;
  disabled?: boolean;
  isThereOriginalRefunds: boolean;
  isRecordCreation: boolean;
  /** Current transaction's splits (for display purposes) */
  currentTransactionSplits?: TransactionSplitModel[];
  /** Current form amount (live value from the form) */
  currentAmount?: number | null;
  /** Current form's currency code */
  currentCurrencyCode?: string;
  /** Current form's category (shown in the picker's link card) */
  currentCategory?: FormattedCategory | null;
  /** Current account ID (for recommendations) */
  currentAccountId?: string | null;
}>();

const emit = defineEmits<{
  'update:refunds': [value: RefundsAnoterTx];
  'update:refundedBy': [value: RefundedByAnotherTxs];
}>();

const { categoriesMap } = storeToRefs(useCategoriesStore());

// `null` marks an existing link as deliberately removed; `undefined` means "never had one".
const clearedValue = () => (props.isThereOriginalRefunds ? null : undefined);

const removeRefund = (removed: RefundWithSplit) => {
  if (props.refunds) {
    emit('update:refunds', clearedValue());
    return;
  }
  const remaining = (props.refundedBy ?? []).filter((item) => item.transaction.id !== removed.transaction.id);
  emit('update:refundedBy', remaining.length > 0 ? remaining : clearedValue());
};

// The picker only ever reports the side it was saved in, so the opposite side has to be
// dropped here; otherwise reopening a linked row and switching mode submits both.
const onRefundsUpdate = (value: RefundsAnoterTx) => {
  emit('update:refunds', value);
  if (props.refundedBy) emit('update:refundedBy', clearedValue());
};

const onRefundedByUpdate = (value: RefundedByAnotherTxs) => {
  emit('update:refundedBy', value);
  if (props.refunds) emit('update:refunds', clearedValue());
};

const refundTransactions = computed<RefundWithSplit[]>(() => {
  if (props.refunds) return [props.refunds];
  if (props.refundedBy) return props.refundedBy;
  return [];
});

// An empty `refundedBy` array must fall back to the default trigger: rendering the
// linked layout with zero rows would leave no way to open the picker or unlink.
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
    :key="transactionType"
    :refunds="refunds"
    :refunded-by="refundedBy"
    :transaction-type="transactionType"
    :disabled="disabled"
    :is-record-creation="isRecordCreation"
    :current-transaction-splits="currentTransactionSplits"
    :current-amount="currentAmount"
    :current-currency-code="currentCurrencyCode"
    :current-category="currentCategory"
    :current-account-id="currentAccountId"
    :current-transaction-id="transactionId"
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
          </div>
        </div>
      </FieldLabel>
    </template>
  </MarkAsRefundDialog>
</template>
