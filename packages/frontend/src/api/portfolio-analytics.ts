import { api } from '@/api/_api';
import type { PortfolioAnalyticsModel, PortfolioBenchmark } from '@bt/shared/types/investments';

export const getPortfolioAnalytics = async ({
  portfolioId,
  from,
  benchmark,
}: {
  portfolioId: string;
  from?: string;
  benchmark?: PortfolioBenchmark;
}): Promise<PortfolioAnalyticsModel> =>
  api.get(`/investments/portfolios/${portfolioId}/analytics`, { from, benchmark });
