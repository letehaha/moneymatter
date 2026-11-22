import { useFormatCurrency } from '@/composable';
import { usePortfolioBalances } from '@/composable/data-queries/portfolio-balances';
import { useCurrenciesStore } from '@/stores';
import type { UserCurrencyModel } from '@bt/shared/types';
import { storeToRefs } from 'pinia';
import { type MaybeRefOrGetter, computed } from 'vue';

/**
 * Provides portfolio-aware currency sorting and labeling.
 *
 * Fetches portfolio balances and uses them to:
 * - sort the user's currencies (non-zero balances first, descending, then alphabetically)
 * - format currency labels with the available cash balance appended
 */
export const usePortfolioCurrencySorting = (portfolioId: MaybeRefOrGetter<string>) => {
  const { currencies } = storeToRefs(useCurrenciesStore());
  const { formatAmountByCurrencyCode } = useFormatCurrency();
  const { data: portfolioBalances } = usePortfolioBalances(portfolioId);

  const balancesByCurrency = computed(() => {
    const map = new Map<string, number>();
    if (portfolioBalances.value) {
      for (const balance of portfolioBalances.value) {
        map.set(balance.currencyCode, Number(balance.availableCash));
      }
    }
    return map;
  });

  const sortedCurrencies = computed(() => {
    const list = (currencies.value || []).filter((c) => !c.currency?.isCustom);
    return list.sort((a, b) => {
      const balA = balancesByCurrency.value.get(a.currencyCode) ?? 0;
      const balB = balancesByCurrency.value.get(b.currencyCode) ?? 0;
      if (balA !== 0 && balB !== 0) return balB - balA;
      if (balA !== 0) return -1;
      if (balB !== 0) return 1;
      return a.currencyCode.localeCompare(b.currencyCode);
    });
  });

  const currencyLabel = (currency: UserCurrencyModel) => {
    const code = currency.currency!.code;
    const balance = balancesByCurrency.value.get(currency.currencyCode);
    if (balance !== undefined && balance !== 0) {
      return `${code} (${formatAmountByCurrencyCode({ amount: balance, currencyCode: currency.currencyCode })})`;
    }
    return code;
  };

  return {
    balancesByCurrency,
    sortedCurrencies,
    currencyLabel,
  };
};
