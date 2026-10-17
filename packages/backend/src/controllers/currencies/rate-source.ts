import { currencyCode } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updateRateSourceBodySchema } from '@services/currencies/rate-sources';
import { searchCoingeckoCoins } from '@services/currencies/rate-sources/coingecko';
import { backfillCoingeckoRates } from '@services/currencies/rate-sources/coingecko-sync';
import { setCurrencyRateSource } from '@services/currencies/rate-sources/set-rate-source.service';
import { z } from 'zod';

export const updateCurrencyRateSource = createController(
  z.object({
    params: z.object({ code: currencyCode() }),
    body: updateRateSourceBodySchema,
  }),
  async ({ user, params, body }) => {
    const { response, changed } = await setCurrencyRateSource({ userId: user.id, code: params.code, body });

    // The source is saved and committed; the history comes from CoinGecko afterwards, so a slow or
    // failing provider never holds the save back.
    if (changed && body.rateSource === 'coingecko') {
      await backfillCoingeckoRates({ userId: user.id, currencyCode: params.code });
    }

    return { data: response };
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
