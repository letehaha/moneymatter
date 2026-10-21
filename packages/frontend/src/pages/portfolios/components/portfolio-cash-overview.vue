<template>
  <!-- Loading -->
  <div v-if="isLoading" class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
    <div v-for="i in 2" :key="i" class="bg-muted/30 flex items-center gap-3 rounded-lg p-3">
      <div class="bg-muted size-8 animate-pulse rounded-full" />
      <div class="flex-1 space-y-1.5">
        <div class="bg-muted h-4 w-16 animate-pulse rounded" />
        <div class="bg-muted h-3 w-24 animate-pulse rounded" />
      </div>
      <div class="space-y-1.5 text-right">
        <div class="bg-muted h-4 w-20 animate-pulse rounded" />
      </div>
    </div>
  </div>

  <!-- Empty state -->
  <p v-else-if="!nonZeroBalances?.length" class="text-muted-foreground py-4 text-center text-sm">
    {{ $t('portfolioDetail.cashBalances.emptyState') }}
  </p>

  <!-- Balances grid -->
  <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
    <div
      v-for="balance in nonZeroBalances"
      :key="balance.currencyCode"
      class="bg-muted/30 flex items-center gap-3 rounded-lg p-3"
    >
      <CurrencyIcon :code="balance.currencyCode" size="size-8" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold">{{ balance.currencyCode }}</p>
        <p v-if="balance.currency?.currency" class="text-muted-foreground truncate text-xs">
          {{ balance.currency.currency }}
        </p>
      </div>

      <div class="text-right">
        <p class="text-sm font-semibold">
          {{ formatAmountByCurrencyCode(Number(balance.availableCash), balance.currencyCode) }}
        </p>
        <p v-if="baseCurrencyCode && balance.currencyCode !== baseCurrencyCode" class="text-muted-foreground text-xs">
          {{ formatAmountByCurrencyCode(Number(balance.refAvailableCash), baseCurrencyCode) }}
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import CurrencyIcon from '@/components/common/currency-icon.vue';
import { usePortfolioBalances } from '@/composable/data-queries/portfolio-balances';
import { useFormatCurrency } from '@/composable/formatters';
import { useCurrenciesStore } from '@/stores/currencies';
import { storeToRefs } from 'pinia';
import { computed, toRef } from 'vue';

const props = defineProps<{ portfolioId: string }>();
const portfolioId = toRef(props, 'portfolioId');

const { data: balances, isLoading } = usePortfolioBalances(portfolioId);

const { formatAmountByCurrencyCode } = useFormatCurrency();
const { baseCurrency } = storeToRefs(useCurrenciesStore());
const baseCurrencyCode = computed(() => baseCurrency.value?.currency?.code);

const nonZeroBalances = computed(() => {
  if (!balances.value) return null;
  return balances.value.filter((b) => Number(b.availableCash) !== 0);
});
</script>
