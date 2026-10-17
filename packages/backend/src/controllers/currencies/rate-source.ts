import { currencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updateRateSourceBodySchema } from '@services/currencies/rate-sources';
import { setCurrencyRateSource } from '@services/currencies/rate-sources/set-rate-source.service';
import { z } from 'zod';

export const updateCurrencyRateSource = createController(
  z.object({
    params: z.object({ code: currencyCode() }),
    body: updateRateSourceBodySchema,
  }),
  async ({ user, params, body }) => {
    const data = await setCurrencyRateSource({ userId: user.id, code: params.code, body });

    return { data };
  },
);
