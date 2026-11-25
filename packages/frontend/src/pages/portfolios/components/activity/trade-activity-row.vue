<template>
  <RouterLink
    :to="{ name: ROUTES_NAMES.portfolioHolding, params: { portfolioId, securityId: trade.securityId } }"
    class="hover:bg-hover flex items-center justify-between gap-3 rounded-md px-2 py-3"
  >
    <div class="flex min-w-0 items-center gap-3">
      <div v-if="logoSource" class="relative size-8 shrink-0">
        <SecurityLogo :security="logoSource" class="size-8" />
        <div class="bg-card ring-card absolute -right-1 -bottom-1 size-4 rounded-full ring-2">
          <div :class="cn('flex size-full items-center justify-center rounded-full', categoryColor)">
            <component :is="categoryIcon" class="size-3" />
          </div>
        </div>
      </div>
      <div v-else class="flex size-8 shrink-0 items-center justify-center rounded-full" :class="categoryColor">
        <component :is="categoryIcon" class="size-4" />
      </div>
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">
          <span>{{ $t(`portfolioDetail.transactionsList.categories.${trade.category}`) }}</span>
          <template v-if="trade.security">
            <span class="text-muted-foreground"> &middot; </span>
            <span class="text-foreground">{{ trade.security.symbol }}</span>
          </template>
        </p>
        <p class="text-muted-foreground truncate text-xs">
          {{ format(trade.date, 'MMM d, yyyy') }}
          <span v-if="trade.quantity">
            &middot; {{ trade.quantity }} {{ $t('portfolioDetail.cashBalances.buysSells.shares') }}</span
          >
        </p>
      </div>
    </div>

    <div class="shrink-0 text-right">
      <p class="text-sm font-semibold" :class="amountColor">
        {{
          maskAmountText({
            text: formatAmountByCurrencyCode({ amount: Number(trade.amount), currencyCode: trade.currencyCode }),
          })
        }}
      </p>
      <p v-if="trade.price" class="text-muted-foreground text-xs">
        @
        {{
          maskAmountText({
            text: formatAmountByCurrencyCode({ amount: Number(trade.price), currencyCode: trade.currencyCode }),
          })
        }}
      </p>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { getSecurityLogoUrl } from '@/common/utils/security-logo-url';
import SecurityLogo from '@/components/common/security-logo.vue';
import { useFormatCurrency } from '@/composable/formatters';
import { useDateLocale } from '@/composable/use-date-locale';
import { maskAmountText } from '@/js/helpers/formatters';
import { cn } from '@/lib/utils';
import { ROUTES_NAMES } from '@/routes/constants';
import type { InvestmentTransactionModel } from '@bt/shared/types';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { ArrowDownIcon, ArrowUpIcon, CircleDollarSignIcon } from '@lucide/vue';
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

const props = defineProps<{ trade: InvestmentTransactionModel; portfolioId: string }>();

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { format } = useDateLocale();

const logoSource = computed(() =>
  props.trade.security && getSecurityLogoUrl(props.trade.security) ? props.trade.security : null,
);

const categoryColor = computed(() => {
  if (props.trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy)
    return 'bg-app-income-color/10 text-app-income-color';
  if (props.trade.category === INVESTMENT_TRANSACTION_CATEGORY.sell)
    return 'bg-app-expense-color/10 text-app-expense-color';
  return 'bg-primary/10 text-primary-text';
});

const categoryIcon = computed(() => {
  if (props.trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy) return ArrowDownIcon;
  if (props.trade.category === INVESTMENT_TRANSACTION_CATEGORY.sell) return ArrowUpIcon;
  return CircleDollarSignIcon;
});

const amountColor = computed(() => {
  if (props.trade.category === INVESTMENT_TRANSACTION_CATEGORY.sell) return 'text-app-expense-color';
  if (props.trade.category === INVESTMENT_TRANSACTION_CATEGORY.buy) return 'text-app-income-color';
  return '';
});
</script>
