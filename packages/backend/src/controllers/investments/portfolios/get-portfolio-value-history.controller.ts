import { dateRange, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPortfolioValueHistory } from '@services/investments/portfolios/get-portfolio-value-history.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    query: withDateOrder(z.object({ ...dateRange() })),
  }),
  async ({ user, params, query }) => {
    const history = await getPortfolioValueHistory({
      userId: user.id,
      portfolioId: params.id,
      from: query.from,
      to: query.to,
    });

    return { data: history };
  },
);
