import type { CurrencyRateSourceResponse } from '@bt/shared/types';

import { backfillCoingeckoRates } from './coingecko-sync';
import { fetchHttpRateAfterSave } from './http-sync';
import type { ValidatedRateSourceBody } from './index';
import { setCurrencyRateSource } from './set-rate-source.service';

/**
 * Saves a currency's rate source, then runs what a change sets in motion. The source is saved and
 * committed first; the history comes from CoinGecko afterwards, or today's rate from the user's URL,
 * so a slow or failing provider never holds the save back. The REST route and the MCP tool both
 * save through it.
 */
export const saveCurrencyRateSource = async ({
  userId,
  code,
  body,
}: {
  userId: number;
  code: string;
  body: ValidatedRateSourceBody;
}): Promise<CurrencyRateSourceResponse> => {
  const { response, changed } = await setCurrencyRateSource({ userId, code, body });

  if (changed && body.rateSource === 'coingecko') {
    await backfillCoingeckoRates({ userId, currencyCode: code });
  }

  if (changed && body.rateSource === 'http') {
    await fetchHttpRateAfterSave({ userId, currencyCode: code });
  }

  return response;
};
