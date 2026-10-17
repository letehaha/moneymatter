import { currencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { testRateSourceBodySchema, updateRateSourceBodySchema } from '@services/currencies/rate-sources';
import { searchCoingeckoCoins } from '@services/currencies/rate-sources/coingecko';
import { saveCurrencyRateSource } from '@services/currencies/rate-sources/save-rate-source.service';
import { testHttpRateSource } from '@services/currencies/rate-sources/test-http-rate-source.service';
import { z } from 'zod';

export const updateCurrencyRateSource = createController(
  z.object({
    params: z.object({ code: currencyCode() }),
    body: updateRateSourceBodySchema,
  }),
  async ({ user, params, body }) => {
    const data = await saveCurrencyRateSource({ userId: user.id, code: params.code, body });

    return { data };
  },
);

export const testCurrencyRateSource = createController(
  z.object({
    params: z.object({ code: currencyCode() }),
    body: testRateSourceBodySchema,
  }),
  async ({ user, params, body }) => {
    const data = await testHttpRateSource({ userId: user.id, code: params.code, body });

    return { data };
  },
);

export const findCoingeckoCoins = createController(
  z.object({
    query: z.object({ query: z.string().trim().min(1).max(100) }),
  }),
  async ({ query }) => {
    const data = await searchCoingeckoCoins({ query: query.query });

    return { data };
  },
);
