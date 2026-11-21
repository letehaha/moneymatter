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
          @select="openCurrency({ currency })"
        />
      </div>

      <CurrencyEditDialog
        v-if="selectedCurrency"
        v-model:open="isEditOpen"
        :currency="selectedCurrency"
        :accounts-count="usageMap[selectedCurrency.currencyCode] ?? 0"
      />

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
import { useCurrencyName } from '@/composable';
import { useAccountsStore, useCurrenciesStore } from '@/stores';
import { useQuery } from '@tanstack/vue-query';
import { CoinsIcon } from '@lucide/vue';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';

import CurrencyEditDialog from './currency-edit-dialog.vue';
import CurrencyListRow from './currency-list-row.vue';
import { buildCurrencyUsageMap } from './currency-usage';
import { roundRate } from './rate-precision';
import { CurrencyWithExchangeRate } from './types';

const RATE_DECIMALS = 4;

const currenciesStore = useCurrenciesStore();
const accountsStore = useAccountsStore();
const { currencies, baseCurrency } = storeToRefs(currenciesStore);
const { accounts } = storeToRefs(accountsStore);
const { getCurrencyName } = useCurrencyName();

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
      const value = Number(rate?.rate);
      const code = item.currency?.code ?? '';

      return {
        ...item,
        // A custom currency carries the name its owner gave it; a translated ISO name could shadow it.
        name: isCustomCurrency
          ? (item.currency?.currency ?? code)
          : getCurrencyName({ code, fallbackName: item.currency?.currency }),
        isCustomCurrency,
        rate: roundRate({ value, isCustom: isCustomCurrency, isoDecimals: RATE_DECIMALS }),
        custom: rate?.custom ?? false,
        quoteCode: rate?.quoteCode ?? baseCurrency.value?.currencyCode ?? '',
        quoteRate: roundRate({ value: 1 / value, isCustom: isCustomCurrency, isoDecimals: RATE_DECIMALS }),
      };
    })
    .sort((a, b) => Number(b.isDefaultCurrency) - Number(a.isDefaultCurrency)),
);

const hasAddedCurrencies = computed(() => currenciesList.value.some((currency) => !currency.isDefaultCurrency));

const usageMap = computed(() => buildCurrencyUsageMap({ accounts: accounts.value ?? [] }));

// A snapshot, so a refresh that drops the currency can't unmount the dialog mid-close. While the
// currency is listed, the dialog follows its refreshed data (a custom currency's editor stays open).
const selectedSnapshot = ref<CurrencyWithExchangeRate | null>(null);
const selectedCurrency = computed(
  () => currenciesList.value.find((item) => item.id === selectedSnapshot.value?.id) ?? selectedSnapshot.value,
);
const isEditOpen = ref(false);

const openCurrency = ({ currency }: { currency: CurrencyWithExchangeRate }) => {
  selectedSnapshot.value = currency;
  isEditOpen.value = true;
};
</script>
