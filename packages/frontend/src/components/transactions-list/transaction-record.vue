<template>
  <div
    :class="[
      'group/row hover:bg-muted/50 grid w-full cursor-pointer rounded-md px-2 py-1 transition-colors [content-visibility:auto]',
      showCheckbox
        ? 'grid-cols-[auto_minmax(0,1fr)_max-content] items-center gap-2'
        : shouldShowGroupedTransfer || isLoadingGroupedTransfer
          ? 'grid-cols-[minmax(0,1fr)_max-content] items-end gap-3'
          : 'grid-cols-[minmax(0,1fr)_max-content] items-center gap-2',
    ]"
    aria-haspopup="true"
    @click="transactionEmit"
  >
    <!-- Selection checkbox -->
    <label v-if="showCheckbox" class="-my-1 -ml-2 flex items-center justify-center self-stretch px-3" @click.stop>
      <Checkbox v-if="isSelectable" v-model="checkedModel" :aria-label="$t('common.transactions.record.selectRow')" />
      <ResponsiveTooltip
        v-else-if="unselectableReason"
        :delay-duration="100"
        :content="$t(`common.transactions.record.unselectableReasons.${unselectableReason}`)"
        content-class-name="max-w-56"
      >
        <InfoIcon class="text-muted-foreground size-3.5 cursor-help" />
      </ResponsiveTooltip>
      <div v-else class="size-4" />
    </label>

    <div class="flex items-center gap-2 overflow-x-clip">
      <template v-if="!isTransferTransaction && !linkTarget && category">
        <div class="relative shrink-0">
          <CategoryCircle :category="category" />
          <ResponsiveTooltip v-if="showAccount && accountFrom" :content="accountFrom.name" :delay-duration="100">
            <!-- Backing tracks the row's hover fill so the badge's cut-out never shows as a halo. -->
            <span
              class="absolute -right-1 -bottom-0.5 cursor-help rounded-sm bg-(--badge-backing) ring-2 ring-(--badge-backing) [--badge-backing:var(--card)] group-hover/row:[--badge-backing:color-mix(in_srgb,var(--muted)_50%,var(--card))]"
              role="img"
              :aria-label="accountFrom.name"
              data-testid="transaction-account-badge"
              @click="isTouch && $event.stopPropagation()"
            >
              <AccountLogo :account="accountFrom" solid class="size-3.5 rounded-sm ring-0" />
            </span>
          </ResponsiveTooltip>
        </div>
      </template>

      <div :class="isCompactInline ? 'flex w-full min-w-0 items-center gap-2 text-left' : 'w-full text-left'">
        <template v-if="isLoadingGroupedTransfer">
          <!-- Loading skeleton: known leg renders on its side (source left, dest
               right); the still-loading opposite leg is a placeholder. -->
          <div class="mb-1 flex items-center gap-1.5">
            <div v-if="ownLegIsIncome" class="h-4 w-20 animate-pulse rounded bg-white/10"></div>
            <template v-else>
              <AccountLogo v-if="accountFrom" :account="accountFrom" class="size-5 shrink-0" />
              <span class="text-sm font-medium tracking-wide">
                {{ accountFrom?.name }}
              </span>
            </template>
            <ArrowRight :size="14" class="opacity-60" />
            <template v-if="ownLegIsIncome">
              <AccountLogo v-if="accountFrom" :account="accountFrom" class="size-5 shrink-0" />
              <span class="text-sm font-medium tracking-wide">
                {{ accountFrom?.name }}
              </span>
            </template>
            <div v-else class="h-4 w-20 animate-pulse rounded bg-white/10"></div>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <div v-if="ownLegIsIncome" class="h-4 w-16 animate-pulse rounded bg-white/10"></div>
            <span v-else class="text-amount text-app-expense-color">{{ formattedExpenseAmount }}</span>
            <ArrowRight :size="12" class="opacity-40" />
            <span v-if="ownLegIsIncome" class="text-amount text-app-income-color">{{ formattedIncomeAmount }}</span>
            <div v-else class="h-4 w-16 animate-pulse rounded bg-white/10"></div>
          </div>
        </template>
        <template v-else-if="shouldShowGroupedTransfer">
          <!-- Grouped transfer: show account movement on top with better styling -->
          <div class="mb-1 flex items-center gap-1.5">
            <div class="flex min-w-17 items-center gap-1.5">
              <AccountLogo v-if="transferFromAccount" :account="transferFromAccount" class="size-5 shrink-0" />
              <span class="line-clamp-1 text-sm font-medium tracking-wide">
                {{ transferFromAccount?.name }}
              </span>
            </div>
            <ArrowRight :size="14" class="shrink-0 opacity-60" />
            <HandCoinsIcon v-if="isLoanDestination" :size="14" class="text-app-transfer-color shrink-0" />
            <div class="flex min-w-17 items-center gap-1.5">
              <AccountLogo v-if="transferToAccount" :account="transferToAccount" class="size-5 shrink-0" />
              <span class="line-clamp-1 text-sm font-medium tracking-wide">
                {{ transferToAccount?.name }}
              </span>
            </div>
          </div>
          <!-- Show both amounts on bottom with better spacing and typography -->
          <div class="flex items-center gap-3 text-sm">
            <span class="text-amount text-app-expense-color whitespace-nowrap">{{ formattedExpenseAmount }}</span>
            <ArrowRight :size="12" class="opacity-40" />
            <span class="text-amount text-app-income-color whitespace-nowrap">{{ formattedIncomeAmount }}</span>
          </div>
        </template>
        <template v-else-if="linkTarget">
          <div :class="['flex items-center gap-1.5', compact && 'min-w-0']">
            <AccountLogo v-if="accountFrom" :account="accountFrom" class="size-5 shrink-0" />
            <span class="line-clamp-1 text-sm tracking-wider">
              {{ accountFrom?.name }}
            </span>
            <ArrowRight :size="14" :class="['shrink-0 opacity-60', linkTarget.flowsToAccount && 'rotate-180']" />
            <component :is="linkTarget.icon" :size="14" class="text-app-transfer-color shrink-0" />
            <div v-if="linkTarget.isLoading" class="h-4 w-16 animate-pulse rounded bg-white/10" />
            <template v-else>
              <span
                class="line-clamp-1 text-sm tracking-wider"
                :class="{ 'text-muted-foreground line-through': linkTarget.isDeleted }"
              >
                {{ linkTarget.name }}
              </span>
              <DeletedBadge v-if="linkTarget.isDeleted" />
            </template>
          </div>
        </template>
        <template v-else-if="isTransferTransaction">
          <div :class="['flex items-center gap-1.5 text-sm tracking-wider', compact && 'min-w-0']">
            <AccountLogo v-if="accountFrom" :account="accountFrom" class="size-5 shrink-0" />
            <span class="line-clamp-1">{{ transferFromLabel }}</span>
            <span class="shrink-0">{{ transferSeparator }}</span>
            <AccountLogo v-if="accountTo" :account="accountTo" class="size-5 shrink-0" />
            <span class="line-clamp-1">{{ transferToLabel }}</span>
          </div>
        </template>
        <template v-else>
          <div :class="['flex items-center gap-2', compact && 'shrink-0']">
            <span class="text-sm tracking-wider whitespace-nowrap">
              {{ category ? category.name : t('common.ui.other') }}
            </span>
            <ResponsiveTooltip
              v-if="addedByTooltip"
              :content="addedByTooltip"
              content-class-name="max-w-56"
              :delay-duration="100"
            >
              <UsersIcon class="text-muted-foreground size-3.5 shrink-0 cursor-help" :aria-label="addedByTooltip" />
            </ResponsiveTooltip>
            <PlannedIndicator v-if="!(hidePlannedMarker && transaction.isPlanned)" :transaction="transaction" />
            <SplitIndicator :transaction="transaction" />
            <RefundIndicator :transaction="transaction" />
            <TagsIndicator :tags="transaction.tags ?? []" :variant="tagsVariant" />
            <AttachmentIndicator :transaction="transaction" />
            <ResponsiveTooltip
              v-if="externalLinkHref && !compact"
              :content="$t('common.transactions.record.externalLinkTooltip')"
              content-class-name="max-w-56"
              :delay-duration="100"
            >
              <a
                :href="externalLinkHref"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="$t('common.transactions.record.externalLinkTooltip')"
                class="text-muted-foreground hover:text-foreground shrink-0"
                @click.stop
              >
                <ExternalLinkIcon class="size-3.5" />
              </a>
            </ResponsiveTooltip>
            <ResponsiveTooltip
              v-if="locationMapUrl && !compact"
              :content="$t('common.transactions.record.locationTooltip')"
              content-class-name="max-w-56"
              :delay-duration="100"
            >
              <a
                :href="locationMapUrl"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="$t('common.transactions.record.locationTooltip')"
                class="text-muted-foreground hover:text-foreground shrink-0"
                @click.stop
              >
                <MapPinIcon class="size-3.5" />
              </a>
            </ResponsiveTooltip>
          </div>
        </template>
        <span
          v-if="!shouldShowGroupedTransfer && !isLoadingGroupedTransfer"
          :class="
            compact
              ? 'text-muted-foreground min-w-0 truncate text-sm'
              : 'text-muted-foreground line-clamp-1 text-sm tracking-wider [word-break:break-word]'
          "
        >
          {{ transaction.note }}
        </span>
      </div>
    </div>
    <div v-if="shouldShowGroupedTransfer || isLoadingGroupedTransfer" class="flex items-start pt-0.5">
      <div class="text-muted-foreground text-right text-xs whitespace-nowrap tabular-nums">
        {{ formateDate(transaction.time) }}
      </div>
    </div>
    <div v-else-if="compact" class="flex items-baseline justify-end gap-2">
      <div class="text-muted-foreground text-xs whitespace-nowrap">
        {{ formateDate(transaction.time) }}
      </div>
      <div
        :class="[
          'text-amount text-right text-sm whitespace-nowrap',
          transaction.transactionType === TRANSACTION_TYPES.income && 'text-app-income-color',
          transaction.transactionType === TRANSACTION_TYPES.expense && 'text-app-expense-color',
        ]"
      >
        {{ formattedAmount }}
      </div>
    </div>
    <div v-else>
      <div
        :class="[
          'text-amount text-right',
          transaction.transactionType === TRANSACTION_TYPES.income && 'text-app-income-color',
          transaction.transactionType === TRANSACTION_TYPES.expense && 'text-app-expense-color',
        ]"
      >
        {{ formattedAmount }}
      </div>
      <div class="text-muted-foreground text-right text-xs">
        {{ formateDate(transaction.time) }}
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import AccountLogo from '@/components/common/account-logo.vue';
import CategoryCircle from '@/components/common/category-circle.vue';
import DeletedBadge from '@/components/common/deleted-badge.vue';
import ResponsiveTooltip from '@/components/common/responsive-tooltip.vue';
import { Checkbox } from '@/components/lib/ui/checkbox';
import { isHttpUrl } from '@/common/utils/external-url';
import { buildMapUrl } from '@/common/utils/map-url';
import { useOppositeTxRecord } from '@/composable/data-queries/opposite-tx-record';
import type { BulkUnselectableReason } from '@/composable/transaction-selection';
import { useTransactionPortfolioLink } from '@/composable/data-queries/portfolio-transfers';
import { useTransactionVentureLink } from '@/composable/data-queries/venture/events';
import { formatUIAmount } from '@/js/helpers';
import { useAccountsStore, useCategoriesStore, useUserStore } from '@/stores';
import {
  isTwoLegTransfer,
  ACCOUNT_CATEGORIES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  TransactionModel,
} from '@bt/shared/types';
import { format } from 'date-fns';
import {
  ArrowRight,
  BriefcaseIcon,
  ExternalLinkIcon,
  InfoIcon,
  HandCoinsIcon,
  MapPinIcon,
  RocketIcon,
  UsersIcon,
} from '@lucide/vue';
import { useMediaQuery } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import PlannedIndicator from './indicators/planned-indicator.vue';
import AttachmentIndicator from './indicators/attachment-indicator.vue';
import RefundIndicator from './indicators/refund-indicator.vue';
import SplitIndicator from './indicators/split-indicator.vue';
import TagsIndicator, { type TagsIndicatorVariant } from '@/components/common/tags-indicator.vue';

const { t } = useI18n();

// On touch the tooltip opens on tap, which would also open the transaction behind it.
const isTouch = useMediaQuery('(pointer: coarse)');

const props = withDefaults(
  defineProps<{
    tx: TransactionModel;
    asButton?: boolean;
    showCheckbox?: boolean;
    isSelected?: boolean;
    isSelectable?: boolean;
    /** Shown as an explainer tooltip in place of the checkbox when not selectable. */
    unselectableReason?: BulkUnselectableReason | null;
    index?: number;
    /** Single-line row: the note renders inline, amount and date share one line. */
    compact?: boolean;
    /** Set where planned rows already sit under their own collapsible header. */
    hidePlannedMarker?: boolean;
    tagsVariant?: TagsIndicatorVariant;
    /** Badges the category circle with the account logo, so it applies to category-circle rows only. */
    showAccount?: boolean;
  }>(),
  {
    asButton: true,
    showCheckbox: false,
    isSelected: false,
    isSelectable: true,
    unselectableReason: null,
    index: 0,
    compact: false,
  },
);

const { categoriesMap } = storeToRefs(useCategoriesStore());
const accountsStore = useAccountsStore();
const { accountsRecord } = storeToRefs(accountsStore);
const { user: currentUser } = storeToRefs(useUserStore());

const emit = defineEmits<{
  'record-click': [[value: TransactionModel, oppositeTx: TransactionModel | undefined]];
  'selection-change': [{ value: boolean; id: string; index: number }];
}>();

// Track props.tx reactively rather than snapshotting it: a list row can be reused
// (kept by :key) while its tx is swapped — e.g. transfer_out_wallet → common_transfer
// after linking. A reactive(props.tx) snapshot would freeze the original object and
// never pick up the new transferId, leaving the opposite leg unresolved.
const transaction = computed(() => props.tx);
const isTransferTransaction = computed(
  () =>
    isTwoLegTransfer(transaction.value.transferNature) ||
    transaction.value.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet,
);

const { data: oppositeTransferTransaction, isLoading: isLoadingOpposite } = useOppositeTxRecord(() => props.tx);

const isPortfolioLinked = computed(
  () => transaction.value.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_portfolio,
);
const portfolioLinkId = computed(() => (isPortfolioLinked.value ? transaction.value.id : undefined));
const { data: portfolioLinkData, isLoading: isLoadingPortfolioLink } = useTransactionPortfolioLink(portfolioLinkId);
const portfolioName = computed(() => portfolioLinkData.value?.portfolioName ?? '');
const isPortfolioDeleted = computed(() => portfolioLinkData.value?.isPortfolioDeleted ?? false);

const { data: ventureLinkData, isLoading: isLoadingVentureLink } = useTransactionVentureLink(transaction);

const linkTarget = computed(() => {
  if (isPortfolioLinked.value) {
    return {
      icon: BriefcaseIcon,
      name: portfolioName.value,
      isDeleted: isPortfolioDeleted.value,
      isLoading: isLoadingPortfolioLink.value,
      flowsToAccount: false,
    };
  }
  if (transaction.value.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_to_venture) {
    return {
      icon: RocketIcon,
      name: ventureLinkData.value?.dealName ?? '',
      isDeleted: ventureLinkData.value?.isDealDeleted ?? false,
      isLoading: isLoadingVentureLink.value,
      // Distributions and exits pay out of the deal into the account.
      flowsToAccount: transaction.value.transactionType === TRANSACTION_TYPES.income,
    };
  }
  return null;
});

// Show grouped transfer display when we have both sides
const shouldShowGroupedTransfer = computed(() => {
  return (
    isTransferTransaction.value &&
    isTwoLegTransfer(transaction.value.transferNature) &&
    oppositeTransferTransaction.value
  );
});

const isLoadingGroupedTransfer = computed(() => {
  return isTransferTransaction.value && isTwoLegTransfer(transaction.value.transferNature) && isLoadingOpposite.value;
});

// Grouped transfers are intrinsically two-line, so they keep the stacked layout even in compact mode.
const isCompactInline = computed(
  () => props.compact && !shouldShowGroupedTransfer.value && !isLoadingGroupedTransfer.value,
);

const category = computed(() => categoriesMap.value[transaction.value.categoryId]);
const externalLinkHref = computed(() =>
  transaction.value.externalUrl && isHttpUrl(transaction.value.externalUrl) ? transaction.value.externalUrl : null,
);
const locationMapUrl = computed(() => (transaction.value.location ? buildMapUrl(transaction.value.location) : null));
const accountFrom = computed(() => accountsRecord.value[transaction.value.accountId]);

// Budget-scoped fetches enrich each tx with `addedBy = { id, username }` describing who
// attached the row to the budget (recipient via metadata.addedByUserId, else the budget
// owner). The icon is only meaningful when the attacher is someone other than the
// viewer — otherwise it reads "Added by yourself", which is noise.
const addedByTooltip = computed(() => {
  const addedBy = transaction.value.addedBy;
  if (!addedBy || addedBy.id === currentUser.value?.id) return undefined;
  return t('common.transactions.record.addedByTooltip', { handle: `@${addedBy.username}` });
});
const accountTo = computed(() =>
  oppositeTransferTransaction.value ? accountsRecord.value[oppositeTransferTransaction.value.accountId] : undefined,
);

// A two-leg row can hold either leg — lists scoped to the destination (e.g. loan
// payments) hand us the income leg. Resolve legs by transaction type rather than
// assuming the row is the expense side.
const ownLegIsIncome = computed(() => transaction.value.transactionType === TRANSACTION_TYPES.income);
const transferSourceLeg = computed(() =>
  ownLegIsIncome.value ? oppositeTransferTransaction.value : transaction.value,
);
const transferDestinationLeg = computed(() =>
  ownLegIsIncome.value ? transaction.value : oppositeTransferTransaction.value,
);
const transferFromAccount = computed(() =>
  transferSourceLeg.value ? accountsRecord.value[transferSourceLeg.value.accountId] : undefined,
);
const transferToAccount = computed(() =>
  transferDestinationLeg.value ? accountsRecord.value[transferDestinationLeg.value.accountId] : undefined,
);

const isLoanDestination = computed(() => transferToAccount.value?.accountCategory === ACCOUNT_CATEGORIES.loan);

const transferSeparator = computed(() =>
  transaction.value.transactionType === TRANSACTION_TYPES.expense ? '=>' : '<=',
);
// Accounts can be undefined when hidden from the caller — e.g. a recipient viewing a
// transfer on a shared account whose other side lives in an unshared private account of
// the owner. Fall back to a labeled placeholder rather than rendering "undefined".
const transferFromLabel = computed(() => accountFrom.value?.name ?? t('common.transactions.record.hiddenAccount'));
const transferToLabel = computed(() => {
  if (transaction.value.transferNature === TRANSACTION_TRANSFER_NATURE.transfer_out_wallet) {
    return t('common.outOfWallet');
  }
  return accountTo.value?.name ?? t('common.transactions.record.hiddenAccount');
});

const formateDate = (date: string | number | Date) => format(new Date(date), 'd MMM y');

const transactionEmit = () => {
  emit('record-click', [transaction.value, oppositeTransferTransaction.value ?? undefined]);
};

// Computed with get/set for v-model binding
const checkedModel = computed({
  get: () => props.isSelected,
  set: (value: boolean | 'indeterminate') => {
    if (!props.isSelectable) return;
    emit('selection-change', {
      value: value === true,
      id: transaction.value.id,
      index: props.index,
    });
  },
});

const formattedAmount = computed(() => {
  let amount = transaction.value.amount;

  if (transaction.value.transactionType === TRANSACTION_TYPES.expense) {
    amount *= -1;
  }

  return formatUIAmount(amount, {
    currency: props.tx.currencyCode,
  });
});

const formattedExpenseAmount = computed(() => {
  const leg = transferSourceLeg.value;
  if (!leg) return '';
  return formatUIAmount(-leg.amount, {
    currency: leg.currencyCode,
  });
});

const formattedIncomeAmount = computed(() => {
  const leg = transferDestinationLeg.value;
  if (!leg) return '';
  return formatUIAmount(leg.amount, {
    currency: leg.currencyCode,
  });
});
</script>
