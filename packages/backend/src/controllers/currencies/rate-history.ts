import { currencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { listCurrencyRateHistory } from '@services/currencies/rate-sources/rate-history.service';
import { z } from 'zod';

export const getCurrencyRateHistory = createController(
  z.object({
    params: z.object({ code: currencyCode() }),
    query: z.object({
      limit: z
        .preprocess((val) => Number(val), z.number().int().min(1).max(100))
        .optional()
        .default(30),
      offset: z
        .preprocess((val) => Number(val), z.number().int().nonnegative())
        .optional()
        .default(0),
    }),
  }),
  async ({ user, params, query }) => {
    const data = await listCurrencyRateHistory({
      userId: user.id,
      code: params.code,
      limit: query.limit,
      offset: query.offset,
    });

    return { data };
  },
);
