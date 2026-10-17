import {
  type CurrencyRateSourceResponse,
  type CurrencyRateSourceSetting,
  ISO_CURRENCY_RATE_SOURCES,
} from '@bt/shared/types';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UsersCurrencies from '@models/users-currencies.model';
import { withTransaction } from '@services/common/with-transaction';

import { assertCurrencyCodesVisible } from '../assert-currency-codes-visible';
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
}): Promise<CurrencyRateSourceResponse> => {
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

  const setting = toSetting(body);
  await held.update(setting);

  return { currencyCode: code, ...setting };
};

/**
 * Saves where the user's rates for a currency come from, and the settings of that source. It only
 * stores the configuration; syncing and recomputing amounts are the sources' own work.
 */
export const setCurrencyRateSource = withTransaction(setCurrencyRateSourceImpl);
