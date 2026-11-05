<script lang="ts">
import type { TransactionModel } from '@bt/shared/types';

export interface AdjustShareRow {
  transaction: TransactionModel;
  categoryId: string;
  label: string;
  /** Purchase (or split) amount, in the purchase currency. */
  purchaseAmount: number;
  /** What is left of the purchase, in the refund currency. */
  cap: number | null;
  isCapApprox: boolean;
  isSameCurrency: boolean;
  refundedByOthers: number;
  share: number | null;
  isAdjusted: boolean;
}
</script>

<script lang="ts" setup>
import CategoryCircle from '@/components/common/category-circle.vue';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import { formatCompactUIAmount, formatUIAmount } from '@/js/helpers';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { fillRefundShares, validateRefundShares } from '../../utils/refund-shares';
import RefundShareMeter from './refund-share-meter.vue';

const props = defineProps<{
  rows: AdjustShareRow[];
  refundAmount: number;
  refundCurrencyCode: string;
}>();

const emit = defineEmits<{
  apply: [value: { shares: number[]; adjusted: boolean[] }];
}>();

const isOpen = defineModel<boolean>('open', { default: false });

const { t } = useI18n();
const { convert } = useExchangeRates();

const KEY = 'dialogs.manageTransaction.markAsRefund';

const drafts = ref<{ value: number | null; isAdjusted: boolean }[]>([]);

watch(isOpen, (open) => {
  if (open) drafts.value = props.rows.map((row) => ({ value: row.share, isAdjusted: row.isAdjusted }));
});

const shares = computed(() => {
  const filled = fillRefundShares({
    refundAmount: props.refundAmount,
    targets: props.rows.map((row, index) => ({
      cap: row.cap,
      isCapApprox: row.isCapApprox,
      share: drafts.value[index]?.isAdjusted ? (drafts.value[index]!.value ?? 0) : null,
    })),
  });
  return props.rows.map((_, index) => (drafts.value[index]?.isAdjusted ? drafts.value[index]!.value : filled[index]!));
});

const validation = computed(() =>
  validateRefundShares({
    refundAmount: props.refundAmount,
    targets: props.rows.map((row, index) => ({
      share: shares.value[index],
      cap: row.cap,
      isSameCurrency: row.isSameCurrency,
    })),
  }),
);

const money = ({ amount, currency }: { amount: number; currency: string }) => formatUIAmount(amount, { currency });

const setShare = ({ index, value }: { index: number; value: number | null }) => {
  drafts.value[index] = { value, isAdjusted: true };
};

const resetToWhole = () => {
  drafts.value = props.rows.map(() => ({ value: null, isAdjusted: false }));
};

const rowHint = ({ row, index }: { row: AdjustShareRow; index: number }) => {
  const share = shares.value[index] ?? 0;
  const error = validation.value.errors[index];
  if (error === 'nonPositive') return { tone: 'error', text: t(`${KEY}.shareErrorNonPositive`) };
  if (error === 'exceedsPurchase') {
    return {
      tone: 'error',
      text: t(`${KEY}.shareErrorExceedsPurchase`, {
        amount: money({ amount: row.cap ?? 0, currency: props.refundCurrencyCode }),
      }),
    };
  }
  if (!row.isSameCurrency) {
    if (validation.value.warnings[index]) {
      return {
        tone: 'warning',
        text: t(`${KEY}.adjustWarningCross`, {
          amount: money({ amount: row.cap ?? 0, currency: props.refundCurrencyCode }),
        }),
      };
    }
    const converted = convert({ amount: share, from: props.refundCurrencyCode, to: row.transaction.currencyCode });
    if (converted === null) return null;
    return {
      tone: 'muted',
      text: t(`${KEY}.adjustHintCross`, {
        share: money({ amount: share, currency: props.refundCurrencyCode }),
        amount: money({ amount: converted, currency: row.transaction.currencyCode }),
      }),
    };
  }
  if (row.cap === null || share >= row.cap) {
    return { tone: 'muted', text: t(row.refundedByOthers > 0 ? `${KEY}.adjustHintRest` : `${KEY}.adjustHintWhole`) };
  }
  return {
    tone: 'muted',
    text: t(`${KEY}.adjustHintPartial`, {
      amount: money({ amount: row.cap - share, currency: row.transaction.currencyCode }),
    }),
  };
};

const hints = computed(() => props.rows.map((row, index) => rowHint({ row, index })));

const meter = computed(() => {
  const { assigned, isOverAssigned } = validation.value;
  const refund = props.refundAmount;
  const currency = props.refundCurrencyCode;
  return {
    segments: shares.value.map((share) => (refund > 0 ? ((share ?? 0) / refund) * 100 : 0)),
    tone: isOverAssigned ? ('error' as const) : ('default' as const),
    label: `${formatCompactUIAmount({ amount: assigned, currency, from: 100_000 })} / ${formatCompactUIAmount({ amount: refund, currency, from: 100_000 })}`,
  };
});

const apply = () => {
  emit('apply', {
    shares: shares.value.map((share) => share ?? 0),
    adjusted: drafts.value.map((draft) => draft.isAdjusted),
  });
  isOpen.value = false;
};
</script>

<template>
  <ResponsiveDialog
    v-model:open="isOpen"
    custom-close
    dialog-content-class="max-h-[90dvh] max-w-md"
    drawer-content-class="max-h-[90dvh]"
  >
    <template #title>{{ $t(`${KEY}.adjustTitle`) }}</template>
    <template #description>
      {{
        $t(
          `${KEY}.adjustDescription`,
          { amount: money({ amount: refundAmount, currency: refundCurrencyCode }), count: rows.length },
          rows.length,
        )
      }}
    </template>

    <div class="flex flex-col gap-3 pb-1">
      <RefundShareMeter v-bind="meter" />

      <div
        v-for="(row, index) in rows"
        :key="row.transaction.id"
        class="border-border bg-card flex flex-col gap-2.5 rounded-xl border p-3"
      >
        <div class="flex min-w-0 items-center gap-3">
          <CategoryCircle :category-id="row.categoryId" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ row.label }}</p>
            <p class="text-muted-foreground truncate text-xs">
              {{ format(new Date(row.transaction.time), 'd MMM y') }} ·
              {{
                $t(`${KEY}.adjustYouPaid`, {
                  amount: money({ amount: row.purchaseAmount, currency: row.transaction.currencyCode }),
                })
              }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-muted-foreground shrink-0 text-sm">{{ $t(`${KEY}.adjustRefundedLabel`) }}</span>
          <div class="min-w-0 flex-1">
            <InputField
              type="number"
              only-positive
              trailing-icon-css-class="px-3"
              :class="validation.errors[index] && 'border-destructive'"
              :model-value="shares[index]"
              :placeholder="$t(`${KEY}.sharePlaceholder`)"
              :aria-label="$t(`${KEY}.shareInputLabel`, { name: row.label })"
              :aria-invalid="Boolean(validation.errors[index])"
              @update:model-value="setShare({ index, value: $event === null ? null : Number($event) })"
            >
              <template #iconTrailing>
                <span class="text-muted-foreground text-sm">{{ refundCurrencyCode }}</span>
              </template>
            </InputField>
          </div>
          <Button
            variant="outline"
            :disabled="row.cap === null || shares[index] === row.cap"
            @click="setShare({ index, value: row.cap })"
          >
            {{ $t(`${KEY}.adjustWholeButton`) }}
          </Button>
        </div>

        <p
          v-if="hints[index]"
          :class="
            cn(
              'text-sm',
              hints[index]!.tone === 'error' && 'text-destructive-text',
              hints[index]!.tone === 'warning' && 'text-warning-text',
              hints[index]!.tone === 'muted' && 'text-muted-foreground',
            )
          "
        >
          {{ hints[index]!.text }}
        </p>
      </div>
    </div>

    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-2">
        <Button variant="link" class="h-auto px-0" @click="resetToWhole">
          {{ $t(`${KEY}.adjustResetButton`) }}
        </Button>
        <span class="flex-1" />
        <Button variant="ghost" @click="isOpen = false">{{ $t('common.actions.cancel') }}</Button>
        <Button :disabled="!validation.isValid" @click="apply">{{ $t('common.actions.done') }}</Button>
      </div>
    </template>
  </ResponsiveDialog>
</template>
