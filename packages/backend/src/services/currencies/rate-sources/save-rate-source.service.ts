import type { CurrencyRateSourceResponse } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { logger } from '@js/utils';
import { toEffectiveDate } from '@models/user-exchange-rates.model';

import { downloadCoinLogo } from './coin-logo';
import { fetchCoingeckoHistory } from './coingecko';
import { fetchHttpRate, HttpRateSourceError } from './http';
import type { ValidatedRateSourceBody } from './index';
import {
  applyRateSourceChange,
  type PreparedRateSourceChange,
  prepareRateSourceChange,
} from './set-rate-source.service';
import type { SyncedDailyRate } from './store-synced-rates';

/**
 * The first rates of a synced source that changed: a year of CoinGecko history, or today's rate from
 * the user's URL. A source that yields none is not saved, so a custom currency never ends up on a
 * source that cannot value it.
 */
const fetchFirstRates = async ({
  code,
  prepared,
}: {
  code: string;
  prepared: PreparedRateSourceChange;
}): Promise<SyncedDailyRate[] | null> => {
  const { setting, headers, changed } = prepared;
  if (!changed || (setting.rateSource !== 'coingecko' && setting.rateSource !== 'http')) return null;

  let rates: SyncedDailyRate[] = [];
  let reason: string | undefined;

  try {
    if (setting.rateSource === 'coingecko') {
      const { coinId, quoteCurrency } = setting.rateSourceConfig;
      rates = await fetchCoingeckoHistory({ coinId, quoteCurrency });
    } else {
      const { urlTemplate, jsonPath, quoteCurrency } = setting.rateSourceConfig;
      const day = toEffectiveDate({ date: new Date() });
      rates = [{ day, rate: await fetchHttpRate({ urlTemplate, jsonPath, quoteCurrency, code, day, headers }) }];
    }
  } catch (error) {
    reason = error instanceof HttpRateSourceError ? error.reason : undefined;
    // The URL and headers of an `http` source may hold an API key, so only its reason is logged.
    const detail = setting.rateSource === 'coingecko' ? (error as Error).message : (reason ?? 'error');
    logger.warn(`The first fetch of the ${setting.rateSource} rate source of ${code} failed (${detail})`);
  }

  if (!rates.length) {
    throw new ValidationError({
      message: t({ key: 'currencies.rateSourceFirstFetchFailed', variables: { code } }),
      ...(reason && { details: { reason } }),
    });
  }

  return rates;
};

/** The coin logo a CoinGecko save writes: a data URL, `null` to clear the image, `undefined` to keep the logo. */
const coinLogoImage = async ({ body }: { body: ValidatedRateSourceBody }): Promise<string | null | undefined> => {
  if (body.rateSource !== 'coingecko' || body.logoUrl === undefined) return undefined;
  if (body.logoUrl === null) return null;

  return (await downloadCoinLogo({ url: body.logoUrl })) ?? undefined;
};

/**
 * Saves a currency's rate source. A synced source that changed is fetched first, outside the
 * transaction, and saved together with the rates it brought; one that brings none is rejected.
 * The REST route and the MCP tool both save through it.
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
  const prepared = await prepareRateSourceChange({ userId, code, body });
  const firstRates = await fetchFirstRates({ code, prepared });
  const logoImage = await coinLogoImage({ body });

  return applyRateSourceChange({ userId, code, prepared, firstRates, logoImage });
};
