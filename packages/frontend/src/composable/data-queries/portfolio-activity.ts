import { getPortfolioActivity } from '@/api/portfolios';
import { VUE_QUERY_CACHE_KEYS } from '@/common/const';
import { useOffsetHistoryQuery } from '@/composable/use-offset-history-query';
import type { PortfolioActivityFilter } from '@bt/shared/types/investments';
import { type MaybeRef, unref } from 'vue';

export const usePortfolioActivity = ({
  portfolioId,
  type,
}: {
  portfolioId: MaybeRef<string>;
  type: MaybeRef<PortfolioActivityFilter>;
}) =>
  useOffsetHistoryQuery({
    queryKey: [...VUE_QUERY_CACHE_KEYS.portfolioActivity, portfolioId, type],
    fetchPage: async ({ limit, offset }) => {
      const { data, pagination } = await getPortfolioActivity({
        portfolioId: unref(portfolioId),
        type: unref(type),
        limit,
        offset,
      });
      return { items: data, totalCount: pagination.totalCount };
    },
  });
