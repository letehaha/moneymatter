<script lang="ts" setup>
import type { RefundRole } from '@/api/transactions';
import ResponsiveDialog from '@/components/common/responsive-dialog.vue';
import { Button } from '@/components/lib/ui/button';
import { useExchangeRates } from '@/composable/data-queries/currencies';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import { formatCompactUIAmount, formatUIAmount } from '@/js/helpers';
import { cn } from '@/lib/utils';
import { useCategoriesStore } from '@/stores';
import { TRANSACTION_TYPES, TransactionModel, TransactionSplitModel } from '@bt/shared/types';
import { CheckIcon, SplitIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { RefundWithSplit, RefundedByAnotherTxs, RefundsAnoterTx } from '../../types';
import { deriveRefundRole } from '../../utils/derive-refund-role';
import {
  finalizeRefundShares,
  getRefundTargetBase,
  getRefundTargetCap,
  isRefundShareAdjusted,
  refillRefundSide,
  round2,
  validateRefundShares,
} from '../../utils/refund-shares';
import { getRefundTargetLabel } from '../../utils/refund-target-label';
import MarkAsRefundInfo from './mark-as-refund-info.vue';
import RecordsList from './refund-records-list.vue';
import RefundShareMeter from './refund-share-meter.vue';
import RefundSharesAdjustDialog, { type AdjustShareRow } from './refund-shares-adjust-dialog.vue';

const props = defineProps<{
  transactionType: TRANSACTION_TYPES;
  isRecordCreation: boolean;
  refunds: RefundsAnoterTx;
  refundedBy: RefundedByAnotherTxs;
  /** Current form amount (live value) */
  currentAmount?: number | null;
  /** Current form's currency code */
  currentCurrencyCode?: string;
  /** Current account ID (for recommendations) */
  currentAccountId?: string | null;
  /** Current transaction ID (for recommendations when editing) */
  currentTransactionId?: string;
  /** Live form time; the pivot that decides which side of the link a ticked row is on. */
  currentTime: Date;
  /** The refund is saved as paying back a purchase outside the app. */
  hasExternalLink?: boolean;
  /** This refund's saved same-currency share per `refundShareKey` target. */
  savedRefundShares?: Record<string, number>;
}>();

const emit = defineEmits<{
  'update:refunds': [value: RefundsAnoterTx];
  'update:refundedBy': [value: RefundedByAnotherTxs];
}>();

const KEY = 'dialogs.manageTransaction.markAsRefund';

const { t } = useI18n();
const { categoriesMap } = storeToRefs(useCategoriesStore());
const { convert } = useExchangeRates();
const isMobileView = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

// `undefined` = untouched since the dialog opened; `[]` = everything unticked.
const selection = ref<RefundWithSplit[] | undefined>(undefined);
// The row whose date decided the role; stays until the set empties so later ticks join its side.
const firstTicked = ref<TransactionModel | null>(null);

const tickHint = ref<string | null>(null);
const pendingTransaction = ref<TransactionModel | null>(null);
const tempSplitSelection = ref<{ splitId: string | null } | null>(null);

const isDialogOpen = ref(false);
const isSplitDialogOpen = ref(false);
const isAdjustDialogOpen = ref(false);

const openDialog = () => {
  isDialogOpen.value = true;
};

defineExpose({ open: openDialog });

// The picker lists candidates of the opposite type, so the current entry's own type is the inverse.
const currentEntryType = computed(() =>
  props.transactionType === TRANSACTION_TYPES.income ? TRANSACTION_TYPES.expense : TRANSACTION_TYPES.income,
);

const roleFor = ({ row }: { row: TransactionModel | null }): RefundRole | null =>
  deriveRefundRole({
    savedRefunds: props.refunds,
    savedRefundedBy: props.refundedBy,
    hasExternalLink: props.hasExternalLink,
    isRecordCreation: props.isRecordCreation,
    firstTicked: row,
    currentTime: props.currentTime,
  });

const role = computed(() => roleFor({ row: firstTicked.value }));
const ticked = computed(() => selection.value ?? []);
const tickedCount = computed(() => ticked.value.length);

const refundAmount = computed(() => (props.currentAmount && props.currentAmount > 0 ? props.currentAmount : 0));

const refill = ({ links, role: side }: { links: RefundWithSplit[]; role: RefundRole | null }) =>
  refillRefundSide({
    links,
    role: side,
    amount: props.currentAmount,
    currencyCode: props.currentCurrencyCode,
    savedShares: props.savedRefundShares,
    convert,
  });

const refillRefunds = ({ links }: { links: RefundWithSplit[] }) => refill({ links, role: 'refund' });

const refillRefundedBy = ({ links }: { links: RefundWithSplit[] }) => refill({ links, role: 'original' });

watch(isDialogOpen, (open) => {
  firstTicked.value = null;
  pendingTransaction.value = null;
  tickHint.value = null;
  if (!open) {
    selection.value = undefined;
    return;
  }
  if (props.refunds?.length) selection.value = refillRefunds({ links: props.refunds });
  else if (props.refundedBy?.length) selection.value = [...props.refundedBy];
  else selection.value = undefined;
});

watch(isSplitDialogOpen, (open) => {
  if (!open) tempSplitSelection.value = null;
});

const setLinks = ({ next }: { next: RefundWithSplit[] }) => {
  selection.value = next;
  if (!next.length) firstTicked.value = null;
};

const sumShares = ({ links }: { links: RefundWithSplit[] }) =>
  round2({ value: links.reduce((sum, link) => sum + (link.amount ?? 0), 0) });

const addRefundTarget = ({ target }: { target: RefundWithSplit }) => {
  const others = props.isRecordCreation ? [] : ticked.value;
  const next = refillRefunds({ links: [...others, { ...target, isAdjusted: false }] });
  if (refundAmount.value && !next[next.length - 1]!.amount) {
    tickHint.value =
      sumShares({ links: others }) >= refundAmount.value
        ? t(`${KEY}.nothingLeftHint`)
        : t(`${KEY}.purchaseFullyRefundedHint`);
    return;
  }
  firstTicked.value ??= target.transaction;
  setLinks({ next });
};

const addRefundedBy = ({ tx }: { tx: TransactionModel }) => {
  // Re-ticking a saved link brings back its saved share, which may be split with other purchases.
  const saved = props.refundedBy?.find((link) => link.transaction.id === tx.id);
  const next = refillRefundedBy({ links: [...ticked.value, saved ?? { transaction: tx, isAdjusted: false }] });
  const added = next[next.length - 1]!;
  if (refundAmount.value && added.transaction.currencyCode === props.currentCurrencyCode && added.amount === 0) {
    tickHint.value = t(`${KEY}.purchasePaidBackHint`);
    return;
  }
  firstTicked.value ??= tx;
  setLinks({ next });
};

const onSelectValue = (tx: TransactionModel) => {
  tickHint.value = null;
  const current = ticked.value;
  if (current.some((link) => link.transaction.id === tx.id)) {
    setLinks({ next: refill({ links: current.filter((link) => link.transaction.id !== tx.id), role: role.value }) });
    return;
  }

  if ((role.value ?? roleFor({ row: tx })) === 'original') {
    addRefundedBy({ tx });
  } else if (tx.splits?.length) {
    pendingTransaction.value = tx;
    tempSplitSelection.value = null;
    isSplitDialogOpen.value = true;
  } else {
    addRefundTarget({ target: { transaction: tx } });
  }
};

const selectTempSplit = (splitId: string | null) => {
  tempSplitSelection.value = { splitId };
};

const confirmSplitSelection = () => {
  if (!pendingTransaction.value) return;

  if (tempSplitSelection.value) {
    addRefundTarget({
      target: {
        transaction: pendingTransaction.value,
        splitId: tempSplitSelection.value.splitId ?? undefined,
      },
    });
  }

  isSplitDialogOpen.value = false;
  tempSplitSelection.value = null;
};

const selectedTransactions = computed(() => ticked.value.map((link) => link.transaction));
const savedRefundedByTransactions = computed(() => (props.refundedBy ?? []).map((link) => link.transaction));

const refundRows = computed(() =>
  role.value === 'refund'
    ? ticked.value.map((link) => ({
        link,
        base: getRefundTargetBase({ link }),
        ...getRefundTargetCap({
          link,
          refundCurrencyCode: props.currentCurrencyCode,
          savedShares: props.savedRefundShares,
          convert,
        }),
      }))
    : [],
);

const isShareCheckActive = computed(() => refundAmount.value > 0 && refundRows.value.length > 0);

const shareValidation = computed(() =>
  validateRefundShares({
    refundAmount: refundAmount.value,
    targets: refundRows.value.map((row) => ({
      share: row.link.amount,
      cap: row.cap,
      isSameCurrency: row.isSameCurrency,
    })),
  }),
);

const refundedByRows = computed(() =>
  role.value === 'original'
    ? ticked.value.map((link) => {
        const { currencyCode, amount } = link.transaction;
        const isSameCurrency = currencyCode === props.currentCurrencyCode;
        const share = link.amount ?? amount;
        const contribution = isSameCurrency
          ? share
          : props.currentCurrencyCode
            ? convert({ amount: share, from: currencyCode, to: props.currentCurrencyCode })
            : null;
        return { link, isSameCurrency, share, contribution };
      })
    : [],
);

const refundedByTotals = computed(() => {
  const rows = refundedByRows.value;
  return {
    paid: round2({ value: rows.reduce((sum, row) => sum + (row.contribution ?? 0), 0) }),
    sameCurrencyPaid: round2({ value: rows.reduce((sum, row) => sum + (row.isSameCurrency ? row.share : 0), 0) }),
    isApprox: rows.some((row) => !row.isSameCurrency),
  };
});

const isRefundedByOverPurchase = computed(
  () =>
    role.value === 'original' && refundAmount.value > 0 && refundedByTotals.value.sameCurrencyPaid > refundAmount.value,
);

const meter = computed(() => {
  const total = refundAmount.value;
  const currency = props.currentCurrencyCode;
  if (!total || !currency) return null;

  const compact = ({ amount }: { amount: number }) => formatCompactUIAmount({ amount, currency, from: 100_000 });
  const label = ({ linked }: { linked: string }) => `${linked} / ${compact({ amount: total })}`;

  if (!role.value) {
    return {
      segments: [],
      tone: 'default' as const,
      label: label({ linked: compact({ amount: 0 }) }),
    };
  }

  if (role.value === 'refund') {
    const { assigned, isOverAssigned } = shareValidation.value;
    return {
      segments: refundRows.value.map((row) => ((row.link.amount ?? 0) / total) * 100),
      tone: isOverAssigned ? ('error' as const) : ('default' as const),
      label: label({ linked: compact({ amount: assigned }) }),
    };
  }

  const { paid, isApprox } = refundedByTotals.value;
  const approx = ({ amount }: { amount: number }) => `${isApprox ? '≈ ' : ''}${compact({ amount })}`;
  return {
    segments: refundedByRows.value.map((row) => ((row.contribution ?? 0) / total) * 100),
    tone: isRefundedByOverPurchase.value
      ? ('error' as const)
      : paid > total
        ? ('warning' as const)
        : ('default' as const),
    label: label({ linked: approx({ amount: paid }) }),
  };
});

const canAdjust = computed(
  () => role.value === 'refund' && isShareCheckActive.value && Boolean(props.currentCurrencyCode),
);

const adjustRows = computed<AdjustShareRow[]>(() =>
  refundRows.value.map((row) => ({
    transaction: row.link.transaction,
    categoryId: row.base.categoryId,
    label: getRefundTargetLabel({
      transaction: row.link.transaction,
      categoryId: row.base.categoryId,
      categoriesMap: categoriesMap.value,
      unknownLabel: t('common.labels.unknown'),
    }),
    purchaseAmount: row.purchaseAmount,
    cap: row.cap,
    isCapApprox: row.isCapApprox,
    isSameCurrency: row.isSameCurrency,
    refundedByOthers: row.refundedByOthers,
    share: row.link.amount ?? null,
    isAdjusted: isRefundShareAdjusted({ link: row.link }),
  })),
);

const applyAdjustedShares = ({ shares, adjusted }: { shares: number[]; adjusted: boolean[] }) => {
  selection.value = ticked.value.map((link, index) => ({
    ...link,
    amount: shares[index] ?? link.amount,
    isAdjusted: adjusted[index] ?? false,
  }));
};

const footerStatus = computed(() => {
  if (role.value === 'refund' && isShareCheckActive.value && !shareValidation.value.isValid) {
    return { isError: true, text: t(`${KEY}.sharesInvalid`) };
  }
  if (isRefundedByOverPurchase.value) return { isError: true, text: t(`${KEY}.refundsOverPurchase`) };

  const count = tickedCount.value;
  if (!count || !role.value) return { isError: false, text: t(`${KEY}.summaryEmpty`) };
  return {
    isError: false,
    text:
      role.value === 'refund'
        ? t(`${KEY}.footerPurchasesTicked`, { count }, count)
        : t(`${KEY}.footerRefundsTicked`, { count }, count),
  };
});

const isSaveDisabled = computed(() => {
  if (selection.value === undefined) return true;
  if (role.value === 'refund') return isShareCheckActive.value && !shareValidation.value.isValid;
  return isRefundedByOverPurchase.value;
});

const getMainCategoryInfo = (tx: TransactionModel) => {
  const category = categoriesMap.value[tx.categoryId];
  const splitsTotal = tx.splits?.reduce((sum, s) => sum + s.amount, 0) ?? 0;
  const mainAmount = tx.amount - splitsTotal;

  return {
    category,
    amount: mainAmount,
    name: category?.name ?? 'Unknown',
    color: category?.color ?? '#666',
  };
};

const getSplitCategoryInfo = (split: TransactionSplitModel) => {
  const category = categoriesMap.value[split.categoryId];
  return {
    category,
    name: category?.name ?? 'Unknown',
    color: category?.color ?? '#666',
  };
};

// An empty set clears only the side that was saved; clearing both at once would send no change at all.
const saveState = () => {
  const next = ticked.value;
  if (!next.length) {
    if (props.refunds?.length) emit('update:refunds', []);
    else if (props.refundedBy?.length) emit('update:refundedBy', []);
  } else if (role.value === 'original') {
    emit('update:refundedBy', next);
  } else {
    emit('update:refunds', finalizeRefundShares({ links: next, refundAmount: props.currentAmount }));
  }
  isDialogOpen.value = false;
};
</script>

<template>
  <div>
    <slot name="trigger" :open="openDialog" />

    <!-- Main Dialog -->
    <ResponsiveDialog
      v-model:open="isDialogOpen"
      custom-close
      sr-only-header
      no-internal-scroll
      dialog-content-class="h-[min(85dvh,46rem)] max-h-[90dvh] gap-0 overflow-hidden p-0"
      drawer-content-class="h-[calc(100dvh-1.25rem)] max-h-[calc(100dvh-1.25rem)] px-0"
    >
      <template #title>{{ $t(`${KEY}.linkRefund`) }}</template>
      <template #description>{{ $t(`${KEY}.directionEmpty`) }}</template>

      <div class="grid min-h-0 min-w-0 flex-1 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
        <!-- Chrome: strip, header, meter -->
        <div class="px-4 pt-3 pb-3 md:px-6 md:pt-0">
          <div
            v-if="!isMobileView"
            :class="
              cn(
                '-mx-6 mb-4 h-3 rounded-t-lg',
                currentEntryType === TRANSACTION_TYPES.income ? 'bg-app-income-color' : 'bg-app-expense-color',
              )
            "
          />
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-lg leading-none font-semibold tracking-tight">
                {{ $t(`${KEY}.linkRefund`) }}
              </p>
              <p class="text-muted-foreground mt-1.5 text-sm">
                {{ $t(`${KEY}.directionEmpty`) }}
                <MarkAsRefundInfo />
              </p>
            </div>
            <Button variant="ghost" class="-mt-1.5 -mr-2 shrink-0" @click="isDialogOpen = false">
              {{ $t('common.ui.close') }}
            </Button>
          </div>

          <p v-if="hasExternalLink && tickedCount" class="text-muted-foreground mt-2 text-sm">
            {{ $t(`${KEY}.externalLinkReplaceNotice`) }}
          </p>

          <div v-if="meter" class="border-border bg-card mt-3 rounded-xl border px-3.5 py-3">
            <RefundShareMeter v-bind="meter">
              <Button
                v-if="canAdjust"
                variant="link"
                size="sm"
                class="h-auto shrink-0 px-0"
                @click="isAdjustDialogOpen = true"
              >
                {{ $t(`${KEY}.adjustAmountsLink`) }}
              </Button>
            </RefundShareMeter>
          </div>
          <p v-if="tickHint" role="status" class="text-warning-text mt-2 text-sm">{{ tickHint }}</p>
        </div>

        <!-- Scrollable records list -->
        <div class="flex min-h-0 flex-col px-2 md:px-4">
          <RecordsList
            :transaction-type="transactionType"
            :role="role"
            :current-time="currentTime"
            :is-record-creation="isRecordCreation"
            :on-select="onSelectValue"
            :selected-transactions="selectedTransactions"
            :saved-transactions="savedRefundedByTransactions"
            :origin-amount="currentAmount"
            :origin-account-id="currentAccountId"
            :origin-transaction-id="currentTransactionId"
          />
        </div>

        <!-- Footer -->
        <div class="border-border bg-dialog flex items-center gap-3 border-t px-4 py-3 md:px-6">
          <p
            role="status"
            :class="cn('min-w-0 text-sm', footerStatus.isError ? 'text-destructive-text' : 'text-muted-foreground')"
          >
            {{ footerStatus.text }}
          </p>
          <Button class="ml-auto min-w-25 shrink-0" :disabled="isSaveDisabled" @click="saveState">
            {{ $t(`${KEY}.saveButton`) }}
          </Button>
        </div>
      </div>
    </ResponsiveDialog>

    <RefundSharesAdjustDialog
      v-model:open="isAdjustDialogOpen"
      :rows="adjustRows"
      :refund-amount="refundAmount"
      :refund-currency-code="currentCurrencyCode ?? ''"
      @apply="applyAdjustedShares"
    />

    <!-- Split Selection Dialog -->
    <ResponsiveDialog
      v-model:open="isSplitDialogOpen"
      custom-close
      dialog-content-class="max-w-md"
      drawer-content-class="max-h-[85dvh]"
    >
      <template #title>
        <span class="flex items-center gap-2">
          <SplitIcon class="text-muted-foreground size-4" />
          {{ $t(`${KEY}.selectWhichPartToRefund`) }}
        </span>
      </template>
      <template #description>
        {{ $t(`${KEY}.transactionSplitInfo`) }}
      </template>

      <template v-if="pendingTransaction">
        <div class="space-y-2">
          <!-- Main category (remaining amount) -->
          <Button
            variant="outline"
            :class="
              cn(
                'h-auto w-full justify-between rounded-lg p-3 text-left',
                tempSplitSelection?.splitId === null && 'border-primary bg-primary/10',
              )
            "
            @click="selectTempSplit(null)"
          >
            <div class="flex items-center gap-2">
              <div
                class="size-3 shrink-0 rounded-full"
                :style="{ backgroundColor: getMainCategoryInfo(pendingTransaction).color }"
              />
              <span class="text-sm font-medium">
                {{ getMainCategoryInfo(pendingTransaction).name }}
              </span>
              <span class="text-muted-foreground text-xs">
                {{ $t(`${KEY}.mainCategoryLabel`) }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm tabular-nums">
                {{
                  formatUIAmount(getMainCategoryInfo(pendingTransaction).amount, {
                    currency: pendingTransaction.currencyCode,
                  })
                }}
              </span>
              <CheckIcon v-if="tempSplitSelection?.splitId === null" class="text-primary-text size-4" />
            </div>
          </Button>

          <!-- Splits -->
          <Button
            v-for="split in pendingTransaction.splits"
            :key="split.id"
            variant="outline"
            :class="
              cn(
                'h-auto w-full justify-between rounded-lg p-3 text-left',
                tempSplitSelection?.splitId === split.id && 'border-primary bg-primary/10',
              )
            "
            @click="selectTempSplit(split.id)"
          >
            <div class="flex items-center gap-2">
              <div
                class="size-3 shrink-0 rounded-full"
                :style="{ backgroundColor: getSplitCategoryInfo(split).color }"
              />
              <span class="text-sm font-medium">
                {{ getSplitCategoryInfo(split).name }}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm tabular-nums">
                {{ formatUIAmount(split.amount, { currency: pendingTransaction.currencyCode }) }}
              </span>
              <CheckIcon v-if="tempSplitSelection?.splitId === split.id" class="text-primary-text size-4" />
            </div>
          </Button>
        </div>

        <div class="mt-6 flex justify-end">
          <Button :disabled="tempSplitSelection === null" @click="confirmSplitSelection">
            {{ $t(`${KEY}.confirmButton`) }}
          </Button>
        </div>
      </template>
    </ResponsiveDialog>
  </div>
</template>
