<script lang="ts" setup>
import type { FormattedCategory } from '@/common/types';
import CategoryCircle from '@/components/common/category-circle.vue';
import { Button } from '@/components/lib/ui/button';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { formatUIAmount } from '@/js/helpers';
import { useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES, type TransactionModel } from '@bt/shared/types';
import { RotateCcwIcon, XIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import type { RefundLinkTotals } from '../../utils/refund-link-totals';

const props = defineProps<{
  mode: 'refunds' | 'refunded';
  currentEntryType: TRANSACTION_TYPES;
  currentAmount?: number | null;
  currentCurrencyCode?: string;
  currentCategory?: FormattedCategory | null;
  selected: TransactionModel[];
  totals: RefundLinkTotals;
}>();

const emit = defineEmits<{ clear: [] }>();

const { t } = useI18n();
const { categoriesMap } = storeToRefs(useCategoriesStore());

const signedAmount = (amount: number, type: TRANSACTION_TYPES) =>
  type === TRANSACTION_TYPES.expense ? -amount : amount;

const amountColorClass = (type: TRANSACTION_TYPES) =>
  type === TRANSACTION_TYPES.income ? 'text-app-income-color' : 'text-app-expense-color';

const formattedCurrentAmount = computed(() => {
  if (!props.currentAmount || props.currentAmount <= 0) return null;
  return formatUIAmount(signedAmount(props.currentAmount, props.currentEntryType), {
    currency: props.currentCurrencyCode,
  });
});

// Single-selection chip only exists in "refunds" mode; "refunded" always renders the count summary.
const singleTx = computed(() => (props.mode === 'refunds' ? (props.selected[0] ?? null) : null));

const singleTxLabel = computed(() => {
  if (!singleTx.value) return '';
  return singleTx.value.note || (categoriesMap.value[singleTx.value.categoryId]?.name ?? t('common.labels.unknown'));
});

const selectedType = computed(() => props.selected[0]?.transactionType ?? TRANSACTION_TYPES.income);

const totalLabel = computed(() => {
  if (props.totals.total === null || !props.totals.currencyCode) return null;
  const formatted = formatUIAmount(signedAmount(props.totals.total, selectedType.value), {
    currency: props.totals.currencyCode,
  });
  return props.totals.isTotalConverted ? `≈ ${formatted}` : formatted;
});

const limitLabel = computed(() => {
  if (!props.currentAmount || props.currentAmount <= 0) return null;
  return formatUIAmount(props.currentAmount, { currency: props.currentCurrencyCode });
});

const showMeter = computed(() => props.mode === 'refunded' && limitLabel.value !== null);

const meterWidth = computed(() => {
  if (props.totals.ratio === null) return '0%';
  return `${Math.min(100, Math.max(props.totals.ratio * 100, 2))}%`;
});

const meterLinkedLabel = computed(() => {
  if (!props.selected.length) {
    return t('dialogs.manageTransaction.markAsRefund.linkedAmountLabel', {
      amount: formatUIAmount(0, { currency: props.currentCurrencyCode }),
    });
  }
  if (totalLabel.value) {
    return t('dialogs.manageTransaction.markAsRefund.linkedAmountLabel', { amount: totalLabel.value });
  }
  return t(
    'dialogs.manageTransaction.markAsRefund.slotSelectedCount',
    { count: props.selected.length },
    props.selected.length,
  );
});
</script>

<template>
  <div class="border-border bg-card @container rounded-xl border p-3">
    <!-- @sm, not @md: the desktop dialog gives the card a ~438px content-box, under @md's 448px. -->
    <div class="grid grid-cols-1 gap-2 @sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @sm:items-stretch">
      <!-- Current entry -->
      <div class="border-input bg-input-background min-w-0 rounded-md border px-2.5 py-2">
        <div class="text-muted-foreground mb-1 text-[10px] font-medium tracking-[0.14em] uppercase">
          {{ $t('dialogs.manageTransaction.markAsRefund.thisEntry') }}
        </div>
        <div class="flex min-w-0 items-center gap-2">
          <CategoryCircle v-if="currentCategory" :category-id="currentCategory.id" />
          <span class="truncate text-[13px]">
            {{ currentCategory?.name ?? $t('common.labels.unknown') }}
          </span>
          <span
            v-if="formattedCurrentAmount"
            :class="['text-amount ml-auto text-[13px] whitespace-nowrap', amountColorClass(currentEntryType)]"
          >
            {{ formattedCurrentAmount }}
          </span>
        </div>
      </div>

      <!-- Direction -->
      <div class="text-primary-text flex items-center justify-center gap-1.5 @sm:flex-col @sm:gap-1 @sm:px-1">
        <RotateCcwIcon class="size-4" />
        <span class="text-[9px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase">
          {{
            mode === 'refunds'
              ? $t('dialogs.manageTransaction.markAsRefund.linkWordRefunds')
              : $t('dialogs.manageTransaction.markAsRefund.linkWordRefundedBy')
          }}
        </span>
      </div>

      <!-- Linked side -->
      <div
        v-if="!selected.length"
        class="border-input text-muted-foreground flex min-w-0 items-center rounded-md border border-dashed px-2.5 py-2 text-xs"
      >
        {{
          mode === 'refunds'
            ? $t('dialogs.manageTransaction.markAsRefund.slotEmptyRefunds')
            : $t('dialogs.manageTransaction.markAsRefund.slotEmptyRefundedBy')
        }}
      </div>
      <div v-else class="border-primary/60 bg-primary/10 flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-2">
        <template v-if="singleTx">
          <CategoryCircle :category-id="singleTx.categoryId" />
          <span class="min-w-0 truncate text-[13px]">{{ singleTxLabel }}</span>
          <span
            :class="['text-amount ml-auto text-[13px] whitespace-nowrap', amountColorClass(singleTx.transactionType)]"
          >
            {{
              formatUIAmount(signedAmount(singleTx.amount, singleTx.transactionType), {
                currency: singleTx.currencyCode,
              })
            }}
          </span>
        </template>
        <template v-else>
          <span class="min-w-0 truncate text-[13px]">
            {{
              $t(
                'dialogs.manageTransaction.markAsRefund.slotSelectedCount',
                { count: selected.length },
                selected.length,
              )
            }}
          </span>
          <span
            v-if="totalLabel"
            :class="['text-amount ml-auto text-[13px] whitespace-nowrap', amountColorClass(selectedType)]"
          >
            {{ totalLabel }}
          </span>
        </template>
        <DesktopOnlyTooltip :content="$t('dialogs.manageTransaction.markAsRefund.clearSelection')">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground -my-1 -mr-1.5 size-6 shrink-0"
            :class="!singleTx && !totalLabel && 'ml-auto'"
            :aria-label="$t('dialogs.manageTransaction.markAsRefund.clearSelection')"
            @click="emit('clear')"
          >
            <XIcon class="size-3.5" />
          </Button>
        </DesktopOnlyTooltip>
      </div>
    </div>

    <!-- "Refunded by" limit meter -->
    <div v-if="showMeter" class="mt-2.5">
      <div class="bg-input h-1 overflow-hidden rounded-full">
        <div
          :class="[
            'h-full rounded-full transition-all duration-200',
            totals.isOverLimit ? 'bg-destructive-text' : 'bg-primary',
          ]"
          :style="{ width: meterWidth }"
        />
      </div>
      <div class="text-muted-foreground mt-1 flex items-center justify-between gap-2 text-[11px] tabular-nums">
        <span class="truncate">{{ meterLinkedLabel }}</span>
        <span :class="totals.isOverLimit && 'text-destructive-text font-medium'" class="whitespace-nowrap">
          {{
            totals.isOverLimit
              ? $t('dialogs.manageTransaction.markAsRefund.limitExceeded', { amount: limitLabel })
              : $t('dialogs.manageTransaction.markAsRefund.linkedOfLimit', { amount: limitLabel })
          }}
        </span>
      </div>
    </div>
  </div>
</template>
