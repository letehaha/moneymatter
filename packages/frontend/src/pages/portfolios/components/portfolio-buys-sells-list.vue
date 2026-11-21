<template>
  <div>
    <!-- Loading -->
    <div v-if="isLoading" class="space-y-3">
      <div v-for="i in 3" :key="i" class="flex items-center justify-between py-2">
        <div class="space-y-1.5">
          <div class="bg-muted h-4 w-24 animate-pulse rounded" />
          <div class="bg-muted h-3 w-16 animate-pulse rounded" />
        </div>
        <div class="bg-muted h-4 w-20 animate-pulse rounded" />
      </div>
    </div>

    <!-- Empty state -->
    <p v-else-if="!transactions?.length" class="text-muted-foreground py-4 text-center text-sm">
      {{ $t('portfolioDetail.cashBalances.buysSells.emptyState') }}
    </p>

    <!-- Transactions list -->
    <div v-else class="divide-y">
      <div v-for="tx in transactions" :key="tx.id" class="flex items-center justify-between py-3 first:pt-0 last:pb-0">
        <div class="flex items-center gap-3">
          <div class="flex size-8 items-center justify-center rounded-full" :class="getCategoryColor(tx.category)">
            <component :is="getCategoryIcon(tx.category)" class="size-4" />
          </div>
          <div>
            <p class="text-sm font-medium">
              <span class="uppercase">{{ tx.category }}</span>
              <span v-if="tx.security" class="text-muted-foreground"> &middot; {{ tx.security.symbol }}</span>
            </p>
            <p class="text-muted-foreground text-xs">
              {{ formatDate(tx.date) }}
              <span v-if="tx.quantity">
                &middot; {{ tx.quantity }} {{ $t('portfolioDetail.cashBalances.buysSells.shares') }}</span
              >
            </p>
          </div>
        </div>

        <div class="text-right">
          <p class="text-sm font-semibold" :class="getAmountColor(tx.category)">
            {{ formatAmountByCurrencyCode({ amount: Number(tx.amount), currencyCode: tx.currencyCode }) }}
          </p>
          <p v-if="tx.price" class="text-muted-foreground text-xs">
            @ {{ formatAmountByCurrencyCode({ amount: Number(tx.price), currencyCode: tx.currencyCode }) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { usePortfolioInvestmentTransactions } from '@/composable/data-queries/investment-transactions';
import { useFormatCurrency } from '@/composable/formatters';
import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { format } from 'date-fns';
import { ArrowDownIcon, ArrowUpIcon, CircleDollarSignIcon } from '@lucide/vue';
import { type Component, computed, ref, toRef } from 'vue';

const props = defineProps<{ portfolioId: string }>();
const portfolioId = toRef(props, 'portfolioId');

const { formatAmountByCurrencyCode } = useFormatCurrency();

const page = ref(1);
const limit = ref(50);
const { data, isLoading } = usePortfolioInvestmentTransactions(portfolioId, page, limit);

const transactions = computed(() => data.value?.transactions);

const formatDate = (date: string) => format(new Date(date), 'MMM d, yyyy');

const getCategoryColor = (category: INVESTMENT_TRANSACTION_CATEGORY) => {
  if (category === INVESTMENT_TRANSACTION_CATEGORY.buy) return 'bg-app-income-color/10 text-app-income-color';
  if (category === INVESTMENT_TRANSACTION_CATEGORY.sell) return 'bg-app-expense-color/10 text-app-expense-color';
  return 'bg-primary/10 text-primary-text';
};

const getCategoryIcon = (category: INVESTMENT_TRANSACTION_CATEGORY): Component => {
  if (category === INVESTMENT_TRANSACTION_CATEGORY.buy) return ArrowDownIcon;
  if (category === INVESTMENT_TRANSACTION_CATEGORY.sell) return ArrowUpIcon;
  return CircleDollarSignIcon;
};

const getAmountColor = (category: INVESTMENT_TRANSACTION_CATEGORY) => {
  if (category === INVESTMENT_TRANSACTION_CATEGORY.sell) return 'text-app-expense-color';
  if (category === INVESTMENT_TRANSACTION_CATEGORY.buy) return 'text-app-income-color';
  return '';
};
</script>
