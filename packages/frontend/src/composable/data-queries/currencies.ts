import {
  changeBaseCurrency,
  getAllCurrencies,
  loadUserBaseCurrency,
  loadUserCurrenciesExchangeRates,
  setBaseUserCurrency,
} from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { getCurrencyDecimals } from '@/js/helpers/currency-decimals';
import { useCurrenciesStore } from '@/stores';
import { CurrencyModel, UserExchangeRatesModel } from '@bt/shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { computed } from 'vue';

/**
 * Query for fetching all system currencies
 */
export const useAllCurrencies = (queryOptions = {}) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryFn: getAllCurrencies,
    queryKey: VUE_QUERY_CACHE_KEYS.allCurrencies,
    staleTime: Infinity, // Currencies rarely change
    placeholderData: [] as CurrencyModel[],
    ...queryOptions,
  });

  return {
    ...query,
    invalidate: () => queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.allCurrencies }),
  };
};

/**
 * Query for fetching user's base currency
 */
export const useBaseCurrency = (queryOptions = {}) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryFn: loadUserBaseCurrency,
    queryKey: VUE_QUERY_CACHE_KEYS.baseCurrency,
    retry: false,
    ...queryOptions,
  });

  return {
    ...query,
    invalidate: () => queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.baseCurrency }),
  };
};

/**
 * Mutation for setting user's base currency
 */
export const useSetBaseCurrency = () => {
  const queryClient = useQueryClient();
  const currenciesStore = useCurrenciesStore();

  return useMutation({
    mutationFn: (currencyCode: string) => setBaseUserCurrency(currencyCode),
    onSuccess: () => {
      // Update Pinia store to ensure route guards work correctly
      currenciesStore.loadBaseCurrency({ force: true });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.baseCurrency });
      queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.userCurrencies });
    },
  });
};

/**
 * Enqueues a base-currency change. The mutation resolves as soon as the job is
 * queued; the change runs in the background and the completion handler (which
 * owns cache invalidation, via a full reset + reload) is driven by
 * `use-base-currency-change-status`.
 */
export const useChangeBaseCurrency = () =>
  useMutation({
    mutationFn: (newCurrencyCode: string) => changeBaseCurrency(newCurrencyCode),
  });

/**
 * Query for fetching user's exchange rates.
 * Returns a map where key is the currency code (baseCode) for easy lookups.
 */
export const useExchangeRates = (queryOptions = {}) => {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryFn: loadUserCurrenciesExchangeRates,
    queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates,
    staleTime: Infinity,
    placeholderData: [] as UserExchangeRatesModel[],
    ...queryOptions,
  });

  const ratesMap = computed(() =>
    (query.data.value ?? []).reduce(
      (acc, rate) => {
        acc[rate.baseCode] = rate;
        return acc;
      },
      {} as Record<string, UserExchangeRatesModel>,
    ),
  );

  /**
   * Converts between two currencies via the shared base rate: A→B = A.rate / B.rate,
   * rounded to the target currency's decimals. Returns null while loading or a rate is missing — treat as
   * "unavailable", not zero.
   */
  const convert = ({ amount, from, to }: { amount: number; from: string; to: string }): number | null => {
    if (from === to) return amount;
    const fromRate = ratesMap.value[from]?.rate;
    const toRate = ratesMap.value[to]?.rate;
    if (!fromRate || !toRate) return null;
    const converted = (amount * fromRate) / toRate;
    if (!Number.isFinite(converted)) return null;
    const factor = 10 ** getCurrencyDecimals({ code: to });
    return Math.round(converted * factor) / factor;
  };

  return {
    ...query,
    ratesMap,
    convert,
    invalidate: () => queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates }),
  };
};
