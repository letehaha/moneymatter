import { isoCurrencyCode, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getPortfolioBalances } from '@services/investments/portfolios/balances';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      id: recordId(),
    }),
    query: z
      .object({
        currencyCode: isoCurrencyCode().optional(),
      })
      .optional(),
  }),
  async ({ user, params, query }) => {
    const balances = await getPortfolioBalances({
      userId: user.id,
      portfolioId: params.id,
      currencyCode: query?.currencyCode,
    });

    return { data: balances };
  },
);
