import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updatePortfolio } from '@services/investments/portfolios/update.service';
import { z } from 'zod';

import { updatePortfolioBodySchema } from './schemas';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    body: updatePortfolioBodySchema,
  }),
  async ({ user, params, body }) => {
    const portfolio = await updatePortfolio({
      userId: user.id,
      portfolioId: params.id,
      ...body,
    });

    return { data: portfolio };
  },
);
