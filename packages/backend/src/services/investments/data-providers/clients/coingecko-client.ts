import { API_ERROR_CODES } from '@bt/shared/types';
import Coingecko from '@coingecko/coingecko-typescript';
import { EnvVar, isEnvConfigured } from '@common/utils/env';
import { ServiceUnavailableError } from '@js/errors';

const COINGECKO_NOT_CONFIGURED_MESSAGE =
  'Crypto search is unavailable. Set COINGECKO_API_KEY in your environment to enable crypto support.';

/** The Demo-tier API key, or `undefined` when none is configured. */
export const getCoinGeckoKey = (): string | undefined =>
  isEnvConfigured(EnvVar.COINGECKO_API_KEY, process.env.COINGECKO_API_KEY) ? process.env.COINGECKO_API_KEY : undefined;

/** The Demo-tier API key; a 503 when CoinGecko is not configured on this instance. */
export const requireCoinGeckoKey = (): string => {
  const apiKey = getCoinGeckoKey();
  if (!apiKey) {
    throw new ServiceUnavailableError({
      code: API_ERROR_CODES.cryptoProviderNotConfigured,
      message: COINGECKO_NOT_CONFIGURED_MESSAGE,
    });
  }

  return apiKey;
};

/** One CoinGecko SDK client, shared by the securities provider and the currency rate source. */
export const createCoingeckoClient = ({ apiKey }: { apiKey: string }): Coingecko =>
  new Coingecko({ demoAPIKey: apiKey, environment: 'demo' });
