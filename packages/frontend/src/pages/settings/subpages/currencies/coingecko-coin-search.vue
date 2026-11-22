<template>
  <div>
    <FieldLabel :label="label">
      <ComboboxRoot
        :open="isDropdownOpen"
        :model-value="selectedCoin"
        by="coinId"
        :disabled="disabled"
        :reset-search-term-on-blur="false"
        :reset-search-term-on-select="false"
        ignore-filter
        @update:open="isOpen = $event"
      >
        <ComboboxAnchor>
          <ComboboxInput
            v-model="searchTerm"
            :placeholder="placeholder"
            :aria-invalid="Boolean(errorMessage)"
            :class="
              cn(
                'border-input bg-input-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
                controlHeight.default,
              )
            "
            data-testid="rate-source-coin-search"
          />
        </ComboboxAnchor>

        <ComboboxPortal>
          <ComboboxContent
            position="popper"
            :side-offset="4"
            class="bg-popover text-popover-foreground z-(--z-dialog) w-(--reka-combobox-trigger-width) overflow-hidden rounded-md border shadow-md"
          >
            <ComboboxViewport class="max-h-72 p-1">
              <div v-if="isSearching" class="grid gap-1" data-testid="rate-source-coin-loading">
                <div v-for="i in SKELETON_ROWS" :key="i" class="bg-muted h-10 animate-pulse rounded-sm" />
              </div>

              <Callout v-else-if="isSearchFailed" variant="destructive" data-testid="rate-source-coin-search-error">
                <span>{{ searchFailedMessage }}</span>
              </Callout>

              <ComboboxGroup v-else-if="coins.length" data-testid="rate-source-coin-results">
                <ComboboxItem
                  v-for="coin in coins"
                  :key="coin.coinId"
                  :value="coin"
                  :class="
                    cn(
                      'flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none',
                      coin.coinId === selectedCoinId ? 'bg-accent' : 'data-highlighted:bg-hover',
                    )
                  "
                  :data-testid="`rate-source-coin-${coin.coinId}`"
                  @select="emit('select', coin)"
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
                </ComboboxItem>
              </ComboboxGroup>

              <p v-else class="text-muted-foreground px-2 py-1.5 text-sm" data-testid="rate-source-coin-empty">
                {{ $t('settings.currencies.rateSource.coingecko.noResults') }}
              </p>
            </ComboboxViewport>
          </ComboboxContent>
        </ComboboxPortal>
      </ComboboxRoot>
    </FieldLabel>
    <FieldError
      :error-message="errorMessage ?? (isSearchFailed && !isDropdownOpen ? searchFailedMessage : undefined)"
      data-testid="rate-source-coin-search-field-error"
    />
  </div>
</template>

<script setup lang="ts">
import { searchCoingeckoCoins } from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import FieldError from '@/components/fields/components/field-error.vue';
import FieldLabel from '@/components/fields/components/field-label.vue';
import { Callout } from '@/components/lib/ui/callout';
import { controlHeight } from '@/components/lib/ui/control-size';
import { extractApiErrorMessage, isApiErrorWithCode } from '@/js/errors';
import { cn } from '@/lib/utils';
import { API_ERROR_CODES, type CoingeckoCoinSearchResult } from '@bt/shared/types';
import { CoinsIcon } from '@lucide/vue';
import { useQuery } from '@tanstack/vue-query';
import { useDebounce } from '@vueuse/core';
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxViewport,
} from 'reka-ui';
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const SEARCH_DEBOUNCE_MS = 300;
const SKELETON_ROWS = 3;

const props = defineProps<{
  label: string;
  placeholder: string;
  /** The coin to mark in the results. */
  selectedCoinId?: string;
  errorMessage?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{ select: [coin: CoingeckoCoinSearchResult]; 'not-configured': [] }>();

const { t } = useI18n();

const searchTerm = ref('');
const isOpen = ref(false);
const trimmedTerm = computed(() => searchTerm.value.trim());
const debouncedTerm = useDebounce(trimmedTerm, SEARCH_DEBOUNCE_MS);

const query = useQuery({
  queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.coingeckoCoinSearch, debouncedTerm.value] as const),
  queryFn: () => searchCoingeckoCoins({ query: debouncedTerm.value }),
  enabled: () => debouncedTerm.value.length > 0,
  retry: false,
  staleTime: Infinity,
});

const coins = computed<CoingeckoCoinSearchResult[]>(() => query.data.value ?? []);
const selectedCoin = computed(() => coins.value.find((coin) => coin.coinId === props.selectedCoinId));
const hasSearched = computed(() => debouncedTerm.value.length > 0 && query.isFetched.value);
// Waiting out the debounce also reads as searching, so the list does not flash "no coins found".
const isSearching = computed(
  () => trimmedTerm.value.length > 0 && (trimmedTerm.value !== debouncedTerm.value || query.isFetching.value),
);
// An instance without a CoinGecko key answers 503; the operator, not the user, can fix it.
const isNotConfigured = computed(() =>
  isApiErrorWithCode(query.error.value, API_ERROR_CODES.cryptoProviderNotConfigured),
);
const isSearchFailed = computed(() => Boolean(query.error.value) && !isNotConfigured.value);
const searchFailedMessage = computed(
  () => extractApiErrorMessage(query.error.value) || t('settings.currencies.rateSource.coingecko.searchFailed'),
);
const isDropdownOpen = computed(
  () =>
    isOpen.value &&
    trimmedTerm.value.length > 0 &&
    !isNotConfigured.value &&
    (isSearching.value || hasSearched.value || isSearchFailed.value),
);

watch(isNotConfigured, (value) => {
  if (value) emit('not-configured');
});
</script>
