<template>
  <div class="flex items-center justify-between gap-3 px-2 py-3">
    <div class="flex min-w-0 items-center gap-3">
      <div class="flex size-8 shrink-0 items-center justify-center rounded-full" :class="dp.iconContainerClass">
        <component :is="dp.icon" class="size-4" />
      </div>
      <div class="min-w-0">
        <p class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
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
        <p class="text-muted-foreground truncate text-xs">
          {{ formatDate(transfer.date) }}
          <span v-if="transfer.description"> &middot; {{ transfer.description }}</span>
        </p>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-3">
      <div v-if="dp.type === 'exchange' && transfer.toCurrencyCode && transfer.toAmount" class="text-right">
        <p class="text-app-expense-color text-sm font-semibold">
          {{
            maskAmountText({
              text: `-${formatAmountByCurrencyCode({ amount: Number(transfer.amount), currencyCode: transfer.currencyCode })}`,
            })
          }}
        </p>
        <p class="text-app-income-color text-sm font-semibold">
          {{
            maskAmountText({
              text: `+${formatAmountByCurrencyCode({ amount: Number(transfer.toAmount), currencyCode: transfer.toCurrencyCode })}`,
            })
          }}
        </p>
      </div>
      <p v-else class="text-right text-sm font-semibold" :class="dp.amountClass">
        {{
          maskAmountText({
            text: `${dp.amountPrefix}${formatAmountByCurrencyCode({ amount: Number(transfer.amount), currencyCode: transfer.currencyCode })}`,
          })
        }}
      </p>

      <div class="hidden items-center gap-1 @md/activity:flex">
        <DesktopOnlyTooltip :content="$t('portfolioDetail.cashBalances.cashTransactions.edit')">
          <UiButton
            variant="ghost"
            size="icon-sm"
            :aria-label="$t('portfolioDetail.cashBalances.cashTransactions.edit')"
            @click="emit('edit')"
          >
            <PencilIcon class="size-3.5" />
          </UiButton>
        </DesktopOnlyTooltip>

        <DesktopOnlyTooltip :content="$t('portfolioDetail.actions.delete')">
          <UiButton
            variant="ghost-destructive"
            size="icon-sm"
            :disabled="deleteDisabled"
            :aria-label="$t('portfolioDetail.actions.delete')"
            @click="emit('delete')"
          >
            <Trash2Icon class="size-3.5" />
          </UiButton>
        </DesktopOnlyTooltip>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <span class="inline-flex @md/activity:hidden">
            <DesktopOnlyTooltip :content="$t('portfolioDetail.cashBalances.cashTransactions.rowActions')">
              <UiButton
                variant="ghost"
                size="icon-sm"
                :aria-label="$t('portfolioDetail.cashBalances.cashTransactions.rowActions')"
              >
                <EllipsisVerticalIcon class="size-4" />
              </UiButton>
            </DesktopOnlyTooltip>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="emit('edit')">
            <PencilIcon class="size-4" />
            {{ $t('portfolioDetail.cashBalances.cashTransactions.edit') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="deleteDisabled" @click="emit('delete')">
            <Trash2Icon class="text-destructive-text size-4" />
            {{ $t('portfolioDetail.actions.delete') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import UiButton from '@/components/lib/ui/button/Button.vue';
import { DesktopOnlyTooltip } from '@/components/lib/ui/tooltip';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { maskAmountText } from '@/js/helpers/formatters';
import type { PortfolioTransferModel } from '@bt/shared/types/investments';
import { ArrowDownIcon, ArrowUpIcon, EllipsisVerticalIcon, PencilIcon, RefreshCwIcon, Trash2Icon } from '@lucide/vue';
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{ transfer: PortfolioTransferModel; portfolioId: string; deleteDisabled?: boolean }>();
const emit = defineEmits<{ edit: []; delete: [] }>();

const { t } = useI18n();
const { formatAmountByCurrencyCode } = useFormatCurrency();

const { format } = useDateLocale();
const formatDate = (date: string) => format(date, 'MMM d, yyyy');

type TransferType = 'deposit' | 'withdrawal' | 'transfer-in' | 'transfer-out';

const getTransferType = ({ transfer }: { transfer: PortfolioTransferModel }): TransferType => {
  if (!transfer.fromAccountId && !transfer.fromPortfolioId && transfer.toPortfolioId) return 'deposit';
  if (!transfer.toAccountId && !transfer.toPortfolioId && transfer.fromPortfolioId) return 'withdrawal';
  if (transfer.fromAccountId) return 'transfer-in';
  if (transfer.toAccountId) return 'transfer-out';
  return transfer.toPortfolioId === props.portfolioId ? 'transfer-in' : 'transfer-out';
};

const dp = computed(() => {
  const { transfer } = props;

  if (transfer.toCurrencyCode && transfer.toAmount) {
    return {
      type: 'exchange' as const,
      label: t('portfolioDetail.cashBalances.cashTransactions.exchange'),
      icon: RefreshCwIcon,
      iconContainerClass: 'bg-app-transfer-color/10 text-app-transfer-color',
      amountClass: 'text-app-transfer-color',
      amountPrefix: '',
    };
  }

  const type = getTransferType({ transfer });
  const isOutgoing = type === 'withdrawal' || type === 'transfer-out';
  const labels: Record<TransferType, string> = {
    deposit: t('portfolioDetail.cashBalances.cashTransactions.deposit'),
    withdrawal: t('portfolioDetail.cashBalances.cashTransactions.withdrawal'),
    'transfer-in': t('portfolioDetail.cashBalances.cashTransactions.transferIn'),
    'transfer-out': t('portfolioDetail.cashBalances.cashTransactions.transferOut'),
  };

  return {
    type,
    label: labels[type],
    icon: isOutgoing ? ArrowUpIcon : ArrowDownIcon,
    iconContainerClass: isOutgoing
      ? 'bg-app-expense-color/10 text-app-expense-color'
      : 'bg-app-income-color/10 text-app-income-color',
    amountClass: isOutgoing ? 'text-app-expense-color' : 'text-app-income-color',
    amountPrefix: isOutgoing ? '-' : '+',
  };
});
</script>
