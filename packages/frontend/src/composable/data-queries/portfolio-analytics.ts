import { getPortfolioAnalytics } from '@/api/portfolio-analytics';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { PortfolioBenchmark } from '@bt/shared/types/investments';
import { useQuery } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

const PORTFOLIO_ANALYTICS_STALE_TIME = 5 * 60 * 1000;
const PORTFOLIO_ID_KEY_INDEX = VUE_QUERY_CACHE_KEYS.portfolioAnalytics.length;

export const usePortfolioAnalytics = ({
  portfolioId,
  from,
  benchmark,
}: {
  portfolioId: MaybeRefOrGetter<string>;
  from: MaybeRefOrGetter<string | undefined>;
  benchmark?: MaybeRefOrGetter<PortfolioBenchmark | null>;
}) =>
  useQuery({
    queryKey: computed(
      () =>
        [
          ...VUE_QUERY_CACHE_KEYS.portfolioAnalytics,
          toValue(portfolioId),
          toValue(from) ?? null,
          toValue(benchmark) ?? null,
        ] as const,
    ),
    queryFn: () =>
      getPortfolioAnalytics({
        portfolioId: toValue(portfolioId),
        from: toValue(from),
        benchmark: toValue(benchmark) ?? undefined,
      }),
    enabled: computed(() => Boolean(toValue(portfolioId))),
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[PORTFOLIO_ID_KEY_INDEX] === toValue(portfolioId) ? previous : undefined,
    staleTime: PORTFOLIO_ANALYTICS_STALE_TIME,
  });
