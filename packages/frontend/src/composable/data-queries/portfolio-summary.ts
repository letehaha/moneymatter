import { getPortfolioSummaries, getPortfolioSummary, getPortfolioValueHistory } from '@/api/portfolios';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import type { PortfolioValueHistoryInterval } from '@bt/shared/types/investments';
import { useQuery } from '@tanstack/vue-query';
import { type MaybeRefOrGetter, computed, toValue } from 'vue';

const PORTFOLIO_SUMMARY_STALE_TIME = 5 * 60 * 1000; // 5 minutes

export const usePortfolioSummary = (portfolioId: MaybeRefOrGetter<string>, date?: MaybeRefOrGetter<string>) => {
  const resolvedDate = () => (date ? toValue(date) : undefined);

  return useQuery({
    queryKey: computed(() => [...VUE_QUERY_CACHE_KEYS.portfolioSummary, toValue(portfolioId), resolvedDate()] as const),
    queryFn: () => getPortfolioSummary({ portfolioId: toValue(portfolioId), date: resolvedDate() }),
    enabled: computed(() => {
      const id = toValue(portfolioId);
      return typeof id === 'string' && id.length > 0;
    }),
    staleTime: PORTFOLIO_SUMMARY_STALE_TIME,
  });
};

/**
 * Current summaries of every non-deleted portfolio in one request; a portfolio whose summary
 * cannot be computed is absent. Anything rendering a list of portfolios reads its entries from
 * here: one `usePortfolioSummary` per item is one request each.
 */
export const usePortfolioSummaries = ({ enabled = true }: { enabled?: MaybeRefOrGetter<boolean> } = {}) =>
  useQuery({
    queryKey: VUE_QUERY_CACHE_KEYS.portfolioSummaries,
    queryFn: getPortfolioSummaries,
    staleTime: PORTFOLIO_SUMMARY_STALE_TIME,
    enabled,
  });

export const usePortfolioValueHistory = ({
  portfolioId,
  range,
}: {
  portfolioId: MaybeRefOrGetter<string>;
  range: MaybeRefOrGetter<{ from: string } | { interval: PortfolioValueHistoryInterval }>;
}) =>
  useQuery({
    queryKey: computed(
      () => [...VUE_QUERY_CACHE_KEYS.portfolioValueHistory, toValue(portfolioId), toValue(range)] as const,
    ),
    queryFn: () => getPortfolioValueHistory({ portfolioId: toValue(portfolioId), ...toValue(range) }),
    enabled: computed(() => Boolean(toValue(portfolioId))),
    staleTime: PORTFOLIO_SUMMARY_STALE_TIME,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey.at(-2) === toValue(portfolioId) ? previous : undefined,
  });
