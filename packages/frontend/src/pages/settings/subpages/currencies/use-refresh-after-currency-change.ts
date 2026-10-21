import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useCurrenciesStore } from '@/stores';
import { useQueryClient } from '@tanstack/vue-query';

/**
 * Pulls fresh data after a custom currency's definition or rates change. Accounts and transactions
 * carry the currency's metadata and their base-currency amounts, so they refetch along with the
 * currency list and the rates.
 */
export const useRefreshAfterCurrencyChange = () => {
  const currenciesStore = useCurrenciesStore();
  const queryClient = useQueryClient();

  return async () => {
    await currenciesStore.loadCurrencies({ force: true });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.allAccounts });
    queryClient.invalidateQueries({
      predicate: (query) => query.queryKey.includes(VUE_QUERY_GLOBAL_PREFIXES.transactionChange),
    });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates });
  };
};
