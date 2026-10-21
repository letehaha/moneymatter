<template>
  <div>
    <div v-if="isLoading" class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border">
      <div v-for="i in 4" :key="i" class="flex items-center gap-3 px-4 py-3">
        <div class="bg-muted size-9 shrink-0 animate-pulse rounded-lg" />
        <div class="flex-1 space-y-2">
          <div class="bg-muted h-4 w-40 animate-pulse rounded" />
          <div class="bg-muted h-3 w-16 animate-pulse rounded" />
        </div>
        <div class="bg-muted h-4 w-24 animate-pulse rounded" />
      </div>
    </div>

    <template v-else>
      <div class="border-border/60 bg-card divide-border/60 divide-y overflow-hidden rounded-xl border">
        <CurrencyListRow
          v-for="currency in currenciesList"
          :key="currency.id"
          :currency="currency"
          :accounts-count="usageMap[currency.currencyCode] ?? 0"
          :expanded="expandedCurrencyCode === currency.currencyCode"
          @toggle="toggleExpanded({ code: currency.currencyCode })"
          @submit="collapseExpanded({ code: currency.currencyCode })"
        />
      </div>

      <div v-if="!hasAddedCurrencies" class="mt-4 flex flex-col items-center gap-1 py-6 text-center">
        <CoinsIcon class="text-muted-foreground/60 mb-1 size-8" aria-hidden="true" />
        <p class="text-sm font-medium">{{ $t('settings.currencies.empty.title') }}</p>
        <p class="text-muted-foreground max-w-sm text-xs">{{ $t('settings.currencies.empty.description') }}</p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { loadUserCurrenciesExchangeRates } from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { useQuery } from '@tanstack/vue-query';
import { CoinsIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import CurrencyListRow from './currency-list-row.vue';
import { buildCurrencyUsageMap } from './currency-usage';
import { CurrencyWithExchangeRate } from './types';

const RATE_DIGITS = 4;
const CUSTOM_RATE_DIGITS = 12;

const currenciesStore = useCurrenciesStore();
const accountsStore = useAccountsStore();
const { currencies, baseCurrency } = storeToRefs(currenciesStore);
const baseCurrencyCode = computed(() => baseCurrency.value?.currency?.code ?? '');
const { accounts } = storeToRefs(accountsStore);

const { data: rates } = useQuery({
  queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates,
  queryFn: loadUserCurrenciesExchangeRates,
  staleTime: Infinity,
  placeholderData: [],
});

const isLoading = computed(() => currencies.value.length === 0);

// Base currency pinned first; every other currency carries the rate pair merged from
// the exchange-rates query so each row can render both directions.
const currenciesList = computed<CurrencyWithExchangeRate[]>(() =>
  currencies.value
    .map((item) => {
      const rate = (rates.value ?? []).find((i) => i.baseCode === item.currency?.code);
      const isCustomCurrency = Boolean(item.currency?.isCustom);
      // A custom currency has no market rate, so the rate the user sets is the only one there is.
      // High precision keeps small rates (a coin worth cents) from rounding to nothing.
      const digits = isCustomCurrency ? CUSTOM_RATE_DIGITS : RATE_DIGITS;
      const quoteRate = Number(Number(1 / Number(rate?.rate)).toFixed(digits));

      return {
        ...item,
        rate: Number(rate?.rate?.toFixed(digits)),
        custom: rate?.custom ?? false,
        // Without a rate yet, the form quotes the custom currency against the base currency.
        quoteCode: rate?.quoteCode ?? (isCustomCurrency ? baseCurrencyCode.value : ''),
        quoteRate,
      };
    })
    .sort((a, b) => Number(b.isDefaultCurrency) - Number(a.isDefaultCurrency)),
);

const hasAddedCurrencies = computed(() => currenciesList.value.some((currency) => !currency.isDefaultCurrency));

const usageMap = computed(() => buildCurrencyUsageMap({ accounts: accounts.value ?? [] }));

// Single-open accordion: expanding a row collapses whichever other row was open.
const expandedCurrencyCode = ref<string | null>(null);

const toggleExpanded = ({ code }: { code: string }) => {
  expandedCurrencyCode.value = expandedCurrencyCode.value === code ? null : code;
};

const collapseExpanded = ({ code }: { code: string }) => {
  if (expandedCurrencyCode.value === code) {
    expandedCurrencyCode.value = null;
  }
};
</script>
