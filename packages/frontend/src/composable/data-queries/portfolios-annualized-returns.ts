import { getPortfoliosAnnualizedReturns } from '@/api/portfolios';
import { QUERY_CACHE_STALE_TIME, VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useQuery } from '@tanstack/vue-query';
import { format } from 'date-fns';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

export const usePortfoliosAnnualizedReturns = ({
  enabled = true,
  asOf = null,
}: { enabled?: MaybeRefOrGetter<boolean>; asOf?: MaybeRefOrGetter<Date | null> } = {}) => {
  const asOfKey = computed(() => {
    const date = toValue(asOf);
    return date === null ? null : format(date, 'yyyy-MM-dd');
  });
  return useQuery({
    queryKey: computed(() =>
      asOfKey.value === null
        ? VUE_QUERY_CACHE_KEYS.portfolioAnnualizedReturns
        : [...VUE_QUERY_CACHE_KEYS.portfolioAnnualizedReturns, asOfKey.value],
    ),
    queryFn: () => getPortfoliosAnnualizedReturns({ asOf: asOfKey.value ?? undefined }),
    staleTime: QUERY_CACHE_STALE_TIME.ANALYTICS,
    enabled,
  });
};
