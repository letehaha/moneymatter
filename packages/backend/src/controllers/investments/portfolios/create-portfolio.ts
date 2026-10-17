import { PORTFOLIO_TYPE } from '@bt/shared/types/investments';
import { isoCurrencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { createPortfolio } from '@services/investments/portfolios/create.service';
import { z } from 'zod';

export default createController(
  z.object({
    body: z.object({
      name: z.string().min(1, 'Portfolio name is required').max(100, 'Portfolio name must be 100 characters or less'),
      portfolioType: z.nativeEnum(PORTFOLIO_TYPE).default(PORTFOLIO_TYPE.investment),
      description: z.string().max(500, 'Description must be 500 characters or less').optional(),
      displayCurrencyCode: isoCurrencyCode().nullable().optional(),
      isEnabled: z.boolean().default(true),
    }),
  }),
  async ({ user, body }) => {
    const portfolio = await createPortfolio({
      userId: user.id,
      ...body,
    });

    return { data: portfolio };
  },
);
