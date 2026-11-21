import { getCachedCurrencyDecimals, setCachedCurrencyDecimals } from '@common/lib/currency-decimals-cache';
import { assertDecimals, Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError, UnexpectedError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import UsersCurrencies, { getBaseCurrency } from '@models/users-currencies.model';

export interface ConversionDecimals {
  /** Decimals of the amount's own currency; the amount is rounded to them before it is converted. */
  baseDecimals: number;
  /** Decimals of the currency the amount converts into; the product is rounded to them. */
  quoteDecimals: number;
}

type CurrencyRoundingMode = 'half-up' | 'half-even';

/**
 * Largest amount whose count of minor units at `decimals` is a safe integer: the report engines
 * convert stored amounts with `toMinorUnits`, which throws above it.
 */
export const getMaxAmountForDecimals = ({ decimals }: { decimals: number }): Money =>
  Money.fromMinorUnits({ value: Number.MAX_SAFE_INTEGER, decimals });

export const assertMoneyWithinMinorUnitRange = ({
  money,
  decimals,
  code,
}: {
  money: Money;
  decimals: number;
  code: string;
}): void => {
  const max = getMaxAmountForDecimals({ decimals });

  if (money.abs().greaterThan(max)) {
    throw new ValidationError({
      message: t({ key: 'currencies.amountTooLarge', variables: { code, max: max.toNumber() } }),
    });
  }
};

const roundAt = ({
  money,
  decimals,
  mode,
  code,
}: {
  money: Money;
  decimals: number;
  mode: CurrencyRoundingMode;
  code: string;
}): Money => {
  const rounded = mode === 'half-even' ? money.roundHalfEven(decimals) : money.round(decimals);
  assertMoneyWithinMinorUnitRange({ money: rounded, decimals, code });

  return rounded;
};

/**
 * Decimals the currency carries for the user. A custom code without the user's definition throws,
 * because the global row is a stub. For an amount on an account, pass the account owner's id.
 */
export const getCurrencyDecimals = async ({ userId, code }: { userId: number; code: string }): Promise<number> => {
  const cached = getCachedCurrencyDecimals({ code }) ?? getCachedCurrencyDecimals({ userId, code });
  if (cached !== undefined) return cached;

  const currency = await Currencies.findOne({ where: { code } });

  if (!currency) {
    throw new NotFoundError({ message: t({ key: 'currencies.unknownCurrencyCode', variables: { code } }) });
  }

  const decimals = currency.isCustom
    ? (
        await UsersCurrencies.findOne({
          where: { userId, currencyCode: code },
          attributes: ['decimalsOverride'],
        })
      )?.decimalsOverride
    : currency.digits;

  if (decimals == null) {
    throw new UnexpectedError({ message: `User ${userId} has no definition of the custom currency ${code}` });
  }
  assertDecimals({ decimals, caller: `Currency ${code}` });

  setCachedCurrencyDecimals({ userId: currency.isCustom ? userId : undefined, code, decimals });

  return decimals;
};

/** Code and decimals of the user's base currency, or null for a user who has not picked one yet. */
const findBaseCurrencyPrecision = async ({ userId }: { userId: number }) => {
  const baseCurrency = await getBaseCurrency({ userId });
  if (!baseCurrency) return null;

  const { code, digits } = baseCurrency.currency;
  assertDecimals({ decimals: digits, caller: `Currency ${code}` });

  return { code, decimals: digits };
};

/** Code and decimals of the user's base currency. A user without a base currency is an error. */
export const getBaseCurrencyPrecision = async ({ userId }: { userId: number }) => {
  const precision = await findBaseCurrencyPrecision({ userId });

  if (!precision) {
    throw new ValidationError({ message: t({ key: 'currencies.noBaseCurrency' }) });
  }

  return precision;
};

/**
 * Number of decimal places of the user's base currency: the scale the report engines (stats,
 * budgets) compute their minor units at. A user without a base currency is an error; read-only
 * reports use `getReportBaseCurrencyDecimals` instead.
 */
export const getBaseCurrencyDecimals = async ({ userId }: { userId: number }): Promise<number> =>
  (await getBaseCurrencyPrecision({ userId })).decimals;

/**
 * `getBaseCurrencyDecimals` for read-only reports. A user without a base currency has nothing
 * converted into one, so the report computes its empty result at 2 decimals instead of failing.
 */
export const getReportBaseCurrencyDecimals = async ({ userId }: { userId: number }): Promise<number> =>
  (await findBaseCurrencyPrecision({ userId }))?.decimals ?? 2;

/**
 * Decimals of both currencies of a conversion, in the shape `calculateRefAmountFromParams` takes.
 * Every per-currency conversion looks them up here, so none rounds a JPY or KWD amount to 2.
 */
export const getConversionDecimals = async ({
  userId,
  baseCode,
  quoteCode,
  definitionOwnerUserId,
}: {
  /** Whose definition of `quoteCode` applies: the user the amount converts for. */
  userId: number;
  baseCode: string;
  quoteCode: string;
  /** Whose definition of `baseCode` applies: the account owner's for an amount on an account. */
  definitionOwnerUserId: number;
}): Promise<ConversionDecimals> => {
  const [baseDecimals, quoteDecimals] = await Promise.all([
    getCurrencyDecimals({ userId: definitionOwnerUserId, code: baseCode }),
    getCurrencyDecimals({ userId, code: quoteCode }),
  ]);

  return { baseDecimals, quoteDecimals };
};

/**
 * Rounds `money` to the currency's decimals. Every rounding helper here also rejects an amount
 * too large for the currency (`assertMoneyWithinMinorUnitRange`).
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

  return roundAt({ money, decimals, mode, code: currencyCode });
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

      return [key, roundAt({ money: value, decimals, mode, code: currencyCode })];
    }),
  ) as TValues;
};
