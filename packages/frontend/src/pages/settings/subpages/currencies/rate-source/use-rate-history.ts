import { loadCurrencyRateHistory } from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { useOffsetHistoryQuery } from '@/composable/use-offset-history-query';
import type { CurrencyRateHistoryItem } from '@bt/shared/types';

export const RATE_HISTORY_PAGE_LIMIT = 20;

/** The stored rates of a custom currency, latest first, loaded a page at a time. */
export const useRateHistory = ({ code }: { code: string }) => {
  const { items: rates, ...rest } = useOffsetHistoryQuery<CurrencyRateHistoryItem>({
    queryKey: [...VUE_QUERY_CACHE_KEYS.currencyRateHistory, code],
    fetchPage: ({ limit, offset }) => loadCurrencyRateHistory({ code, limit, offset }),
    pageLimit: RATE_HISTORY_PAGE_LIMIT,
  });

  return { rates, ...rest };
};
