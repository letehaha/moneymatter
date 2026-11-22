import { VUE_QUERY_CACHE_KEYS, VUE_QUERY_GLOBAL_PREFIXES } from '@/common/const';
import { useNotificationCenter } from '@/components/notification-center';
import { captureException } from '@/lib/sentry';
import { useCurrenciesStore } from '@/stores';
import { useQueryClient } from '@tanstack/vue-query';
import { useI18n } from 'vue-i18n';

/** Refetches what a currency or rate change alters. A failed reload warns instead of throwing, as the change is saved. */
export const useRefreshAfterCurrencyChange = () => {
  const queryClient = useQueryClient();
  const currenciesStore = useCurrenciesStore();
  const { addWarningNotification } = useNotificationCenter();
  const { t } = useI18n();

  return async () => {
    // Accounts and transactions carry the currency's metadata and base-currency values.
    queryClient.invalidateQueries({ queryKey: [VUE_QUERY_GLOBAL_PREFIXES.transactionChange] });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.exchangeRates });
    // A custom currency's rates are dated, so a change can alter the rate of any past day.
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.currencyRateHistory });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.exchangeRatePair });
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.exchangeRatesForDate });

    try {
      await currenciesStore.loadCurrencies({ force: true });
    } catch (error) {
      captureException({ error, context: { scope: 'currencies:refresh-after-change' } });
      addWarningNotification(t('settings.currencies.refreshFailed'));
    }
  };
};
