<template>
  <div class="grid gap-3">
    <InputField
      v-model="searchTerm"
      :label="label"
      :placeholder="placeholder"
      :disabled="disabled"
      :error-message="errorMessage"
      data-testid="rate-source-coin-search"
    />

    <Callout v-if="isNotConfigured" variant="warning" data-testid="rate-source-coingecko-not-configured">
      <span>{{ $t('settings.currencies.rateSource.coingecko.notConfigured') }}</span>
    </Callout>
    <Callout v-else-if="isSearchFailed" variant="destructive" data-testid="rate-source-coin-search-error">
      <span>{{ $t('settings.currencies.rateSource.coingecko.searchFailed') }}</span>
    </Callout>

    <div v-if="isSearching" class="grid gap-2" data-testid="rate-source-coin-loading">
      <div v-for="i in SKELETON_ROWS" :key="i" class="bg-muted h-10 animate-pulse rounded-md" />
    </div>

    <ul v-else-if="coins.length" class="grid gap-1" data-testid="rate-source-coin-results">
      <li v-for="coin in coins" :key="coin.coinId">
        <Button
          type="button"
          variant="outline"
          :class="
            cn(
              'h-auto w-full justify-start px-3 py-2 text-left font-normal',
              coin.coinId === selectedCoinId && 'border-primary bg-primary/10',
            )
          "
          :disabled="disabled"
          :data-testid="`rate-source-coin-${coin.coinId}`"
          @click="emit('select', coin)"
        >
          <img
            v-if="coin.logoUrl"
            :src="coin.logoUrl"
            :alt="coin.name"
            class="size-6 shrink-0 rounded-full"
            loading="lazy"
          />
          <CoinsIcon v-else class="text-muted-foreground size-5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ coin.name }}</span>
          <span class="text-muted-foreground shrink-0 text-xs uppercase">{{ coin.symbol }}</span>
          <span v-if="coin.marketCapRank" class="text-muted-foreground shrink-0 text-xs tabular-nums">
            #{{ coin.marketCapRank }}
          </span>
        </Button>
      </li>
    </ul>

    <p
      v-else-if="hasSearched && !isNotConfigured && !isSearchFailed"
      class="text-muted-foreground text-sm"
      data-testid="rate-source-coin-empty"
    >
      {{ $t('settings.currencies.rateSource.coingecko.noResults') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { searchCoingeckoCoins } from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import InputField from '@/components/fields/input-field.vue';
import { Button } from '@/components/lib/ui/button';
import { Callout } from '@/components/lib/ui/callout';
import { isApiErrorWithCode } from '@/js/errors';
import { cn } from '@/lib/utils';
import { API_ERROR_CODES, type CoingeckoCoinSearchResult } from '@bt/shared/types';
import { CoinsIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { useDebounce } from '@vueuse/core';
import { computed, ref } from 'vue';

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 3;

/**
 * A CoinGecko coin lookup: a search box and the matching coins to pick from. Shared by the CoinGecko
 * rate source and the logo field of the custom currency dialog.
 */
defineProps<{
  label: string;
  placeholder: string;
  /** The coin to mark in the results. */
  selectedCoinId?: string;
  errorMessage?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ select: [coin: CoingeckoCoinSearchResult] }>();

const searchTerm = ref('');
const debouncedTerm = useDebounce(
  computed(() => searchTerm.value.trim()),
  SEARCH_DEBOUNCE_MS,
);

const query = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.coingeckoCoinSearch, debouncedTerm.value] as const),
  queryFn: () => searchCoingeckoCoins({ query: debouncedTerm.value }),
  enabled: () => debouncedTerm.value.length > 0,
  retry: false,
  staleTime: Infinity,
});

const coins = computed<CoingeckoCoinSearchResult[]>(() => query.data.value ?? []);
const hasSearched = computed(() => debouncedTerm.value.length > 0 && query.isFetched.value);
// Waiting out the debounce also reads as searching, so the list does not flash "no coins found".
const isSearching = computed(
  () =>
    searchTerm.value.trim().length > 0 && (searchTerm.value.trim() !== debouncedTerm.value || query.isFetching.value),
);
// An instance without a CoinGecko key answers 503; the operator, not the user, can fix it.
const isNotConfigured = computed(() =>
  isApiErrorWithCode(query.error.value, API_ERROR_CODES.cryptoProviderNotConfigured),
);
const isSearchFailed = computed(() => Boolean(query.error.value) && !isNotConfigured.value);
</script>
