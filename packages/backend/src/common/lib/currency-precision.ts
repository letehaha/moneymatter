import { getCachedCurrencyDecimals, setCachedCurrencyDecimals } from '@common/lib/currency-decimals-cache';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import { getBaseCurrency } from '@models/users-currencies.model';

export interface ConversionDecimals {
  /** Decimals of the amount's own currency; the amount is rounded to them before it is converted. */
  baseDecimals: number;
  /** Decimals of the currency the amount converts into; the product is rounded to them. */
  quoteDecimals: number;
}

type CurrencyRoundingMode = 'half-up' | 'half-even';

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
 * Number of decimal places of the user's base currency: the scale the report engines (stats,
 * budgets) compute their minor units at. A user without a base currency is an error, never 2.
 */
export const getBaseCurrencyDecimals = async ({ userId }: { userId: number }): Promise<number> => {
  const baseCurrency = await getBaseCurrency({ userId });

  if (!baseCurrency) {
    throw new ValidationError({ message: t({ key: 'currencies.noBaseCurrency' }) });
  }

  return getCurrencyDecimals({ userId, code: baseCurrency.currencyCode });
};

/**
 * Decimals of both currencies of a conversion, in the shape `calculateRefAmountFromParams` takes.
 * Every per-currency conversion looks them up here, so none rounds a JPY or KWD amount to 2.
 */
export const getConversionDecimals = async ({
  userId,
  baseCode,
  quoteCode,
}: {
  userId: number;
  baseCode: string;
  quoteCode: string;
}): Promise<ConversionDecimals> => {
  const [baseDecimals, quoteDecimals] = await Promise.all([
    getCurrencyDecimals({ userId, code: baseCode }),
    getCurrencyDecimals({ userId, code: quoteCode }),
  ]);

  return { baseDecimals, quoteDecimals };
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

type OptionalMoney = Money | null | undefined;

/**
 * Rounds every present value of `values` to the currency's decimals with one decimals lookup.
 * `null` and `undefined` stay as they are, so a partial update payload keeps its "not provided"
 * and "clear" meanings. Without a single present value there is no lookup at all.
 */
export const roundMoneyValues = async <TValues extends Record<string, OptionalMoney>>({
  values,
  userId,
  currencyCode,
  mode,
}: {
  values: TValues;
  userId: number;
  currencyCode: string;
  mode: CurrencyRoundingMode;
}): Promise<TValues> => {
  const entries = Object.entries(values) as [string, OptionalMoney][];

  if (entries.every(([, value]) => value === null || value === undefined)) return values;

  const decimals = await getCurrencyDecimals({ userId, code: currencyCode });

  return Object.fromEntries(
    entries.map(([key, value]) => {
      if (value === null || value === undefined) return [key, value];

      return [key, mode === 'half-even' ? value.roundHalfEven(decimals) : value.round(decimals)];
    }),
  ) as TValues;
};

/**
 * Rejects an amount that carries more decimals than the currency does. For inputs that must not be
 * silently rounded, such as a budget figure: the person sees the limit instead of a changed number.
 */
export const assertMoneyFitsCurrency = async ({
  money,
  userId,
  currencyCode,
}: {
  money: Money;
  userId: number;
  currencyCode: string;
}): Promise<void> => {
  const decimals = await getCurrencyDecimals({ userId, code: currencyCode });

  if (!money.round(decimals).equals(money)) {
    throw new ValidationError({
      message: t({ key: 'currencies.amountExceedsDecimals', variables: { code: currencyCode, decimals } }),
    });
  }
};
