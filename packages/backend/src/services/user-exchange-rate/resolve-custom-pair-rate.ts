import { t } from '@i18n/index';
import { ExchangeRateUnavailableError } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';
import Big from 'big.js';

interface ResolvedRate {
  baseCode: string;
  quoteCode: string;
  date: Date;
  rate: number;
  custom?: boolean;
}

type ResolveRate = (params: { baseCode: string; quoteCode: string }) => Promise<ResolvedRate>;

const unavailable = ({ pair, date }: { pair: { baseCode: string; quoteCode: string }; date: Date }) =>
  new ExchangeRateUnavailableError({
    message: t({
      key: 'currencies.exchangeRateNotAvailable',
      variables: { baseCode: pair.baseCode, quoteCode: pair.quoteCode, date: date.toISOString() },
    }),
  });

/**
 * Walks a custom code down to the first code that is not custom, through the quote currency of the
 * user's own rate for each step. `factor` is how many units of `code` that ISO currency one unit of
 * the custom code is worth. A custom code without a rate, or a loop of custom codes, has no value.
 */
const priceInIsoCurrency = async ({
  userId,
  code,
  customCodes,
  date,
  pair,
}: {
  userId: number;
  code: string;
  customCodes: ReadonlySet<string>;
  date: Date;
  pair: { baseCode: string; quoteCode: string };
}): Promise<{ code: string; factor: number }> => {
  const visited = new Set<string>();
  let current = code;
  let factor = 1;

  while (customCodes.has(current)) {
    if (visited.has(current)) throw unavailable({ pair, date });
    visited.add(current);

    const step = await getStoredCustomRate({ userId, baseCode: current });
    if (!step) throw unavailable({ pair, date });

    factor *= step.rate;
    current = step.quoteCode;
  }

  return { code: current, factor };
};

/**
 * The user's stored rate for a custom code: the most recently written one when several quotes exist.
 * The rate stays in the quote currency it was entered in, so a base-currency change never rewrites it.
 */
const getStoredCustomRate = async ({ userId, baseCode }: { userId: number; baseCode: string }) => {
  return UserExchangeRates.findOne({ where: { userId, baseCode }, order: [['date', 'DESC']], raw: true });
};

/**
 * Rate of a pair in which at least one side is a custom currency. It never touches the global
 * cross-rate cache, which is keyed by date and code only.
 *
 * 1. A rate the user entered for exactly this pair wins.
 * 2. Otherwise each custom side is priced in the quote currency of the user's own rate for it, and
 *    the remaining ISO-to-ISO conversion goes through `resolveIsoRate`, so a manual ISO rate into
 *    the base wins and the market rate fills in otherwise.
 *
 * Custom rates keep their full precision: the 5-decimal market formatting would erase a coin worth
 * a fraction of a cent.
 */
export const resolveCustomPairRate = async ({
  userId,
  pair,
  date,
  customCodes,
  resolveIsoRate,
}: {
  userId: number;
  pair: { baseCode: string; quoteCode: string };
  date: Date;
  customCodes: ReadonlySet<string>;
  resolveIsoRate: ResolveRate;
}): Promise<ResolvedRate> => {
  const exact = await UserExchangeRates.findOne({
    where: { userId, baseCode: pair.baseCode, quoteCode: pair.quoteCode },
    order: [['date', 'DESC']],
    raw: true,
  });
  if (exact)
    return { baseCode: pair.baseCode, quoteCode: pair.quoteCode, date: exact.date, rate: exact.rate, custom: true };

  const base = await priceInIsoCurrency({ userId, code: pair.baseCode, customCodes, date, pair });
  const quote = await priceInIsoCurrency({ userId, code: pair.quoteCode, customCodes, date, pair });

  const isoRate =
    base.code === quote.code ? 1 : (await resolveIsoRate({ baseCode: base.code, quoteCode: quote.code })).rate;

  // Decimal arithmetic, so chaining rates does not add binary floating-point noise.
  const rate = new Big(base.factor).times(isoRate).div(quote.factor).toNumber();

  return { ...pair, rate, date, custom: true };
};
