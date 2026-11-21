<template>
  <div>
    <!-- Loading -->
    <div v-if="isLoading" class="space-y-3">
      <div v-for="i in SKELETON_ROWS" :key="i" class="flex items-center justify-between py-2">
        <div class="space-y-1.5">
          <div class="bg-muted h-4 w-24 animate-pulse rounded" />
          <div class="bg-muted h-3 w-16 animate-pulse rounded" />
        </div>
        <div class="bg-muted h-4 w-20 animate-pulse rounded" />
      </div>
    </div>

    <!-- Empty state -->
    <div v-else-if="!rows.length" class="flex flex-col items-center gap-2 py-8 text-center">
      <div class="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <ArrowRightLeftIcon class="size-5" />
      </div>
      <p class="text-sm font-medium">{{ $t('portfolioDetail.cashBalances.cashTransactions.emptyState') }}</p>
      <p class="text-muted-foreground max-w-xs text-xs">
        {{ $t('portfolioDetail.cashBalances.cashTransactions.emptyStateDescription') }}
      </p>
    </div>

    <!-- Transfers list -->
    <div v-else class="divide-y">
      <div
        v-for="{ transfer, dp } in rows"
        :key="transfer.id"
        class="flex items-center justify-between py-3 first:pt-0 last:pb-0"
      >
        <div class="flex items-center gap-3">
          <div class="flex size-8 items-center justify-center rounded-full" :class="dp.iconContainerClass">
            <component :is="dp.icon" class="size-4" />
          </div>
          <div>
            <p class="flex items-center gap-2 text-sm font-medium">
              {{ dp.label }}
              <span
                v-if="transfer.isAdjustment"
                class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tracking-wide uppercase"
              >
                {{ $t('portfolioDetail.cashBalances.cashTransactions.adjustmentBadge') }}
              </span>
              <span
                v-if="!transfer.affectsCash"
                class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tracking-wide uppercase"
              >
                {{ $t('portfolioDetail.cashBalances.cashTransactions.noCashBadge') }}
              </span>
            </p>
            <p class="text-muted-foreground text-xs">
              {{ formatDate(transfer.date) }}
              <span v-if="transfer.description"> &middot; {{ transfer.description }}</span>
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <div v-if="dp.type === 'exchange' && transfer.toCurrencyCode && transfer.toAmount" class="text-right">
            <p class="text-app-expense-color text-sm font-semibold">
              -{{
                formatAmountByCurrencyCode({ amount: Number(transfer.amount), currencyCode: transfer.currencyCode })
              }}
            </p>
            <p class="text-app-income-color text-sm font-semibold">
              +{{
                formatAmountByCurrencyCode({ amount: Number(transfer.toAmount), currencyCode: transfer.toCurrencyCode })
              }}
            </p>
          </div>
          <div v-else class="text-right">
            <p class="text-sm font-semibold" :class="dp.amountClass">
              {{ dp.amountPrefix
              }}{{
                formatAmountByCurrencyCode({ amount: Number(transfer.amount), currencyCode: transfer.currencyCode })
              }}
            </p>
          </div>

          <template v-if="!isMobile">
            <DesktopOnlyTooltip :content="$t('portfolioDetail.cashBalances.cashTransactions.edit')">
              <UiButton
                variant="ghost"
                size="icon-sm"
                :aria-label="$t('portfolioDetail.cashBalances.cashTransactions.edit')"
                @click="openEditDialog(transfer)"
              >
                <PencilIcon class="size-3.5" />
              </UiButton>
            </DesktopOnlyTooltip>

            <DesktopOnlyTooltip :content="$t('portfolioDetail.actions.delete')">
              <UiButton
                variant="ghost-destructive"
                size="icon-sm"
                :disabled="deleteMutation.isPending.value"
                :aria-label="$t('portfolioDetail.actions.delete')"
                @click="openDeleteDialog(transfer)"
              >
                <Trash2Icon class="size-3.5" />
              </UiButton>
            </DesktopOnlyTooltip>
          </template>

          <DropdownMenu v-else>
            <DropdownMenuTrigger as-child>
              <UiButton
                variant="ghost"
                size="icon-sm"
                :aria-label="$t('portfolioDetail.cashBalances.cashTransactions.rowActions')"
              >
                <EllipsisVerticalIcon class="size-4" />
              </UiButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem @click="openEditDialog(transfer)">
                <PencilIcon class="mr-2 size-4" />
                {{ $t('portfolioDetail.cashBalances.cashTransactions.edit') }}
              </DropdownMenuItem>
              <DropdownMenuItem :disabled="deleteMutation.isPending.value" @click="openDeleteDialog(transfer)">
                <Trash2Icon class="text-destructive-text mr-2 size-4" />
                {{ $t('portfolioDetail.actions.delete') }}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
    <div v-if="transfersQuery.hasNextPage.value" ref="sentinelRef" class="flex justify-center p-3">
      <Loader2Icon v-if="transfersQuery.isFetchingNextPage.value" class="text-muted-foreground size-4 animate-spin" />
    </div>
    <EditCashTransactionDialog v-model:open="isEditDialogOpen" :portfolio-id="portfolioId" :transfer="transferToEdit" />

    <!-- Delete confirmation dialog -->
    <ResponsiveAlertDialog
      v-model:open="isDeleteDialogOpen"
      :cancel-label="$t('forms.directCashTransaction.cancelButton')"
      :confirm-label="$t('portfolioDetail.actions.delete')"
      confirm-variant="destructive"
      @confirm="confirmDelete"
    >
      <template #title>
        {{ $t('portfolioDetail.cashBalances.cashTransactions.deleteConfirm') }}
      </template>
      <template v-if="transferToDelete?.transactionId" #description>
        {{ $t('portfolioDetail.cashBalances.cashTransactions.linkedTransactionNote') }}
      </template>

      <RadioGroup v-if="transferToDelete?.transactionId" v-model="linkedTxAction" class="gap-3">
        <div class="flex items-center gap-2">
          <RadioGroupItem id="keep" value="keep" />
          <Label for="keep" class="cursor-pointer text-sm font-normal">
            {{ $t('portfolioDetail.cashBalances.cashTransactions.keepLinkedTransaction') }}
          </Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroupItem id="delete" value="delete" />
          <Label for="delete" class="cursor-pointer text-sm font-normal">
            {{ $t('portfolioDetail.cashBalances.cashTransactions.deleteLinkedTransaction') }}
          </Label>
        </div>
      </RadioGroup>
    </ResponsiveAlertDialog>
  </div>
</template>

<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import ResponsiveAlertDialog from '@/components/common/responsive-alert-dialog.vue';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { Label } from '@/components/lib/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/lib/ui/radio-group';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useDeletePortfolioTransfer, usePortfolioTransfers } from '@/composable/data-queries/portfolio-transfers';
import { useFormatCurrency } from '@/composable/formatters';
import { CUSTOM_BREAKPOINTS, useWindowBreakpoints } from '@/composable/window-breakpoints';
import EditCashTransactionDialog from '@/pages/portfolios/components/edit-cash-transaction-dialog.vue';
import type { PortfolioModel } from '@bt/shared/types';
import type { PortfolioTransferModel } from '@bt/shared/types/investments';
import { useIntersectionObserver } from '@vueuse/core';
import { format } from 'date-fns';
import {
  ArrowDownIcon,
  ArrowRightLeftIcon,
  ArrowUpIcon,
  EllipsisVerticalIcon,
  Loader2Icon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from '@lucide/vue';
import { computed, ref, toRef } from 'vue';
import { useI18n } from 'vue-i18n';

const SKELETON_ROWS = 3;

const props = defineProps<{ portfolioId: string; portfolio: PortfolioModel }>();
const portfolioId = toRef(props, 'portfolioId');

const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();
// Row actions collapse into a dropdown on phones, matching the Cash Balances header.
const isMobile = useWindowBreakpoints(CUSTOM_BREAKPOINTS.uiMobile);

const transfersQuery = usePortfolioTransfers(portfolioId);
const isLoading = computed(() => !transfersQuery.isFetched.value);
const deleteMutation = useDeletePortfolioTransfer();

const rows = computed(() =>
  transfersQuery.items.value.map((transfer) => ({ transfer, dp: getTransferDisplayProps(transfer) })),
);

const sentinelRef = ref<HTMLElement | null>(null);
useIntersectionObserver(sentinelRef, ([entry]) => {
  if (entry?.isIntersecting && transfersQuery.hasNextPage.value && !transfersQuery.isFetchingNextPage.value) {
    transfersQuery.fetchNextPage();
  }
});

const isEditDialogOpen = ref(false);
const transferToEdit = ref<PortfolioTransferModel | null>(null);

const openEditDialog = (transfer: PortfolioTransferModel) => {
  transferToEdit.value = transfer;
  isEditDialogOpen.value = true;
};

const linkedTxAction = ref<'keep' | 'delete'>('keep');
const isDeleteDialogOpen = ref(false);
const transferToDelete = ref<PortfolioTransferModel | null>(null);

const openDeleteDialog = (transfer: PortfolioTransferModel) => {
  transferToDelete.value = transfer;
  linkedTxAction.value = 'keep';
  isDeleteDialogOpen.value = true;
};

const confirmDelete = () => {
  if (transferToDelete.value) {
    handleDelete(transferToDelete.value);
  }
};

const formatDate = (date: string) => format(new Date(date), 'MMM d, yyyy');

function isCurrencyExchange(transfer: PortfolioTransferModel): boolean {
  return !!transfer.toCurrencyCode && !!transfer.toAmount;
}

function getTransferDisplayProps(transfer: PortfolioTransferModel) {
  if (isCurrencyExchange(transfer)) {
    return {
      type: 'exchange' as const,
      label: t('portfolioDetail.cashBalances.cashTransactions.exchange'),
      icon: RefreshCwIcon,
      iconContainerClass: 'bg-app-transfer-color/10 text-app-transfer-color',
      amountClass: 'text-app-transfer-color',
      amountPrefix: '',
    };
  }

  let type: string;

  if (!transfer.fromAccountId && !transfer.fromPortfolioId && transfer.toPortfolioId) {
    type = 'deposit';
  } else if (!transfer.toAccountId && !transfer.toPortfolioId && transfer.fromPortfolioId) {
    type = 'withdrawal';
  } else if (transfer.fromAccountId) {
    type = 'transfer-in';
  } else if (transfer.toAccountId) {
    type = 'transfer-out';
  } else if (transfer.toPortfolioId === props.portfolioId) {
    type = 'transfer-in';
  } else {
    type = 'transfer-out';
  }

  const isOutgoing = type === 'withdrawal' || type === 'transfer-out';

  const labels: Record<string, string> = {
    deposit: t('portfolioDetail.cashBalances.cashTransactions.deposit'),
    withdrawal: t('portfolioDetail.cashBalances.cashTransactions.withdrawal'),
    'transfer-in': t('portfolioDetail.cashBalances.cashTransactions.transferIn'),
    'transfer-out': t('portfolioDetail.cashBalances.cashTransactions.transferOut'),
  };

  return {
    type: type as 'deposit' | 'withdrawal' | 'transfer-in' | 'transfer-out',
    label: labels[type] || type,
    icon: isOutgoing ? ArrowUpIcon : ArrowDownIcon,
    iconContainerClass: isOutgoing
      ? 'bg-app-expense-color/10 text-destructive-text'
      : 'bg-app-income-color/10 text-app-income-color',
    amountClass: isOutgoing ? 'text-app-expense-color' : 'text-app-income-color',
    amountPrefix: isOutgoing ? '-' : '+',
  };
}

const handleDelete = async (transfer: PortfolioTransferModel) => {
  await deleteMutation.mutateAsync({
    portfolioId: props.portfolioId,
    transferId: transfer.id,
    deleteLinkedTransaction: transfer.transactionId ? linkedTxAction.value === 'delete' : undefined,
  });
  isDeleteDialogOpen.value = false;
};
</script>
