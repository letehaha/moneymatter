import { PORTFOLIO_BENCHMARK_KEYS } from '@bt/shared/types';
import { dateRange, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPortfolioAnalytics } from '@services/investments/portfolios/analytics/get-portfolio-analytics.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    query: withDateOrder(z.object({ ...dateRange(), benchmark: z.enum(PORTFOLIO_BENCHMARK_KEYS).optional() })),
  }),
  async ({ user, params, query }) => {
    const analytics = await getPortfolioAnalytics({
      userId: user.id,
      portfolioId: params.id,
      from: query.from,
      to: query.to,
      benchmark: query.benchmark,
    });

    return { data: analytics };
  },
);
