import { PORTFOLIO_VALUE_HISTORY_INTERVALS } from '@bt/shared/types/investments';
import { dateRange, recordId, withDateOrder } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPortfolioValueHistory } from '@services/investments/portfolios/get-portfolio-value-history.service';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({ id: recordId() }),
    query: withDateOrder(z.object({ ...dateRange(), interval: z.enum(PORTFOLIO_VALUE_HISTORY_INTERVALS).optional() })),
  }),
  async ({ user, params, query }) => {
    const history = await getPortfolioValueHistory({
      userId: user.id,
      portfolioId: params.id,
      from: query.from,
      to: query.to,
      interval: query.interval,
    });

    return { data: history };
  },
);
