import { getWatchlist } from '@/api/watchlist';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useInvalidatingMutation } from '@/composable/data-queries/use-invalidating-mutation';
import { useFormatCurrency } from '@/composable/formatters';
import { useQuery } from '@tanstack/vue-query';
import type { Ref } from 'vue';

export const useWatchlist = ({ portfolioId }: { portfolioId: Ref<string> }) =>
  useQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.portfolioWatchlist, portfolioId],
    queryFn: () => getWatchlist({ portfolioId: portfolioId.value }),
  });

export const useWatchlistMutation = <TData, TVariables>({
  mutationFn,
  successKey,
  errorKey,
  onSuccess,
}: {
  mutationFn: (variables: TVariables) => Promise<TData>;
  successKey?: string;
  errorKey: string;
  onSuccess?: (data: TData) => void;
}) =>
  useInvalidatingMutation({
    mutationFn,
    invalidateKeys: [VUE_QUERY_CACHE_KEYS.portfolioWatchlist],
    successKey,
    errorKey,
    onSuccess,
  });

export const useFormatWatchlistPrice = () => {
  const { formatAmountByCurrencyCode } = useFormatCurrency();
  return ({ value, currencyCode }: { value: string | null; currencyCode: string }) =>
    value === null ? '—' : formatAmountByCurrencyCode({ amount: Number(value), currencyCode });
};
