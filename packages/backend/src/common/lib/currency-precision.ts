import { getCachedCurrencyDecimals, setCachedCurrencyDecimals } from '@common/lib/currency-decimals-cache';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError } from '@js/errors';
import Currencies from '@models/currencies.model';

export type CurrencyRoundingMode = 'half-up' | 'half-even';

/**
 * Number of decimal places the currency carries for the user.
 *
 * Reads `Currencies.digits`. Results are cached per `userId + code`; the cache is dropped
 * by the `Currencies` model hooks whenever a currency row changes.
 */
export const getCurrencyDecimals = async ({ userId, code }: { userId: number; code: string }): Promise<number> => {
  const cached = getCachedCurrencyDecimals({ userId, code });
  if (cached !== undefined) return cached;

  const currency = await Currencies.findOne({ where: { code } });

  if (!currency) {
    throw new NotFoundError({ message: t({ key: 'currencies.unknownCurrencyCode', variables: { code } }) });
  }

  setCachedCurrencyDecimals({ userId, code, decimals: currency.digits });

  return currency.digits;
};

/**
 * Rounds `money` to the currency's decimals.
 *
 * `half-up` is for amounts the user or an import provides; `half-even` is for converted values
 * (reference amounts, balance revaluation), where ties must not accumulate a bias.
 */
export const roundToCurrency = async ({
  money,
  userId,
  currencyCode,
  mode,
}: {
  money: Money;
  userId: number;
  currencyCode: string;
  mode: CurrencyRoundingMode;
}): Promise<Money> => {
  const decimals = await getCurrencyDecimals({ userId, code: currencyCode });

  return mode === 'half-even' ? money.roundHalfEven(decimals) : money.round(decimals);
};
