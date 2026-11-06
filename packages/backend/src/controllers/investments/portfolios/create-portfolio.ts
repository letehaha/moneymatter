import { createController } from '@controllers/helpers/controller-factory';
import { createPortfolio } from '@services/investments/portfolios/create.service';
import { z } from 'zod';

import { createPortfolioBodyShape } from './schemas';

export default createController(
  z.object({
    body: z.object(createPortfolioBodyShape),
  }),
  async ({ user, body }) => {
    const portfolio = await createPortfolio({
      userId: user.id,
      ...body,
    });

    return { data: portfolio };
  },
);
