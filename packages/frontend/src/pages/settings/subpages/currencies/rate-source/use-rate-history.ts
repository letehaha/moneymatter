import { loadCurrencyRateHistory } from '@/api/currencies';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const/vue-query';
import { useOffsetHistoryQuery } from '@/composable/use-offset-history-query';
import type { CurrencyRateHistoryItem } from '@bt/shared/types';
import { useQueryClient } from '@tanstack/vue-query';

export const RATE_HISTORY_PAGE_LIMIT = 20;

const getRateHistoryQueryKey = ({ code }: { code: string }) => [...VUE_QUERY_CACHE_KEYS.currencyRateHistory, code];

/** The stored rates of a custom currency, latest first, loaded a page at a time. */
export const useRateHistory = ({ code }: { code: string }) => {
  const { items: rates, ...rest } = useOffsetHistoryQuery<CurrencyRateHistoryItem>({
    queryKey: getRateHistoryQueryKey({ code }),
    fetchPage: ({ limit, offset }) => loadCurrencyRateHistory({ code, limit, offset }),
    pageLimit: RATE_HISTORY_PAGE_LIMIT,
  });

  return { rates, ...rest };
};

/** Reloads the history of a currency after a rate or its source changed. */
export const useInvalidateRateHistory = () => {
  const queryClient = useQueryClient();

  return ({ code }: { code: string }) => queryClient.invalidateQueries({ queryKey: getRateHistoryQueryKey({ code }) });
};
