import {
  type CurrencyRateSourceResponse,
  type CurrencyRateSourceSetting,
  ISO_CURRENCY_RATE_SOURCES,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UserExchangeRates from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';
import { requireCoinGeckoKey } from '@services/investments/data-providers/clients/coingecko-client';
import { isDeepStrictEqual } from 'node:util';

import { assertCurrencyCodesVisible } from '../assert-currency-codes-visible';
import { recomputeCustomRefAmounts } from '../recompute-custom-ref-amounts.service';
import type { ValidatedRateSourceBody } from './index';

const isIsoRateSource = (rateSource: string): boolean =>
  (ISO_CURRENCY_RATE_SOURCES as readonly string[]).includes(rateSource);

const toSetting = (body: ValidatedRateSourceBody): CurrencyRateSourceSetting => {
  switch (body.rateSource) {
    case 'provider':
    case 'manual':
      return { rateSource: body.rateSource, rateSourceConfig: null };
    case 'peg':
      return { rateSource: 'peg', rateSourceConfig: body.config };
    case 'coingecko':
      return { rateSource: 'coingecko', rateSourceConfig: body.config };
    case 'http':
      return { rateSource: 'http', rateSourceConfig: body.config };
  }
};

const setCurrencyRateSourceImpl = async ({
  userId,
  code,
  body,
}: {
  userId: number;
  code: string;
  body: ValidatedRateSourceBody;
}): Promise<{ response: CurrencyRateSourceResponse; changed: boolean }> => {
  const held = (await UsersCurrencies.findOne({
    where: { userId, currencyCode: code },
    include: [{ model: Currencies, as: 'currency', required: true }],
  })) as (UsersCurrencies & { currency: Currencies }) | null;

  if (!held) {
    throw new NotFoundError({ message: t({ key: 'currencies.rateSourceCurrencyNotHeld', variables: { code } }) });
  }

  // An ISO currency is priced by the market feed or by the user's own rates. The other sources
  // price what no feed covers, and a custom currency has no feed to fall back on.
  if (!held.currency.isCustom && !isIsoRateSource(body.rateSource)) {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceIsoNotAllowed', variables: { code } }) });
  }

  if (held.currency.isCustom && body.rateSource === 'provider') {
    throw new ValidationError({ message: t({ key: 'currencies.rateSourceCustomNoProvider', variables: { code } }) });
  }

  if (body.rateSource === 'peg') {
    if (body.config.pegCurrency === code) {
      throw new ValidationError({ message: t({ key: 'currencies.rateSourcePegSelf', variables: { code } }) });
    }

    await assertCurrencyCodesVisible({ userId, codes: [body.config.pegCurrency] });
  }

  // Synced sources quote in an ISO currency, so a stored rate never depends on another custom rate.
  if (body.rateSource === 'coingecko' || body.rateSource === 'http') {
    await assertCurrencyCodesVisible({ userId, codes: [body.config.quoteCurrency], isoOnly: true });
  }

  // A synced source can only run on an instance that has the provider's key.
  if (body.rateSource === 'coingecko') requireCoinGeckoKey();

  const setting = toSetting(body);
  const changed =
    held.rateSource !== setting.rateSource || !isDeepStrictEqual(held.rateSourceConfig, setting.rateSourceConfig);
  const wasCoingecko = held.rateSource === 'coingecko';
  await held.update(setting);

  // Rates fetched for another coin or quote would mix into the new coin's history, so they go. The
  // rates of a source the user switches away from stay, as the history of that currency.
  if (changed && wasCoingecko && setting.rateSource === 'coingecko') {
    await UserExchangeRates.destroy({ where: { userId, baseCode: code, source: 'coingecko' } });
  }

  // The rates of every day come from the new source now, so what was valued under the old one is
  // valued again. An ISO currency keeps the base amounts it was saved with.
  if (changed && held.currency.isCustom) {
    await recomputeCustomRefAmounts({
      userId,
      changes: [{ currencyCode: code, from: null, to: null, mode: 'recompute' }],
    });
  }

  return { response: { currencyCode: code, ...setting }, changed };
};

/**
 * Saves where the user's rates for a currency come from, and the settings of that source. A custom
 * currency whose source changed has its saved rows valued again; fetching a synced source's rates
 * is that source's own work, which the caller starts once this has committed (`changed` says
 * whether the saved source differs from the one before).
 */
export const setCurrencyRateSource = withTransaction(setCurrencyRateSourceImpl);
