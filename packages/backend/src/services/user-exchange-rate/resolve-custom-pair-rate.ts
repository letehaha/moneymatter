import { t } from '@i18n/index';
import { ExchangeRateUnavailableError } from '@js/errors';
import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import Big from 'big.js';
import { Op } from 'sequelize';

interface ResolvedRate {
  baseCode: string;
  quoteCode: string;
  date: Date;
  rate: number;
  custom?: boolean;
}

type IsCustomCode = (params: { code: string }) => Promise<boolean>;

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
 *
 * Whether a quote is custom is asked at every step, not read from the codes of the requested pair: a
 * rate can quote another custom code, and treating that code as ISO would hand it to the ISO
 * resolution, which would come back here and walk the same loop again. The rate editor stores both
 * directions of a pair, so a step never takes a rate that quotes a code already walked when another
 * rate exists; only a walk with nothing else left is a loop.
 */
const priceInIsoCurrency = async ({
  userId,
  code,
  isCustom,
  date,
  pair,
}: {
  userId: number;
  code: string;
  isCustom: IsCustomCode;
  date: Date;
  pair: { baseCode: string; quoteCode: string };
}): Promise<{ code: string; factor: number }> => {
  const asOfDate = toEffectiveDate({ date });
  const visited = new Set<string>();
  let current = code;
  let factor = 1;

  while (await isCustom({ code: current })) {
    if (visited.has(current)) throw unavailable({ pair, date });
    visited.add(current);

    const step = await getStoredCustomRate({ userId, baseCode: current, asOfDate, excludedQuotes: [...visited] });
    if (!step) throw unavailable({ pair, date });

    factor *= step.rate;
    current = step.quoteCode;
  }

  return { code: current, factor };
};

/**
 * The user's stored rate for a custom code on a day: the one that started most recently on or before
 * it (the one written last when several start on the same day), skipping rates that quote a code in
 * `excludedQuotes`. A day before the first rate has none.
 * The rate stays in the quote currency it was entered in, so a base-currency change never rewrites it.
 */
const getStoredCustomRate = async ({
  userId,
  baseCode,
  asOfDate,
  excludedQuotes,
}: {
  userId: number;
  baseCode: string;
  asOfDate: string;
  excludedQuotes: readonly string[];
}) => {
  return UserExchangeRates.findOne({
    where: { userId, baseCode, quoteCode: { [Op.notIn]: excludedQuotes }, effectiveDate: { [Op.lte]: asOfDate } },
    order: [
      ['effectiveDate', 'DESC'],
      ['date', 'DESC'],
    ],
    raw: true,
  });
};

/**
 * Rate of a pair in which at least one side is a custom currency, on the day of `date`. It never
 * touches the global cross-rate cache, which is keyed by date and code only.
 *
 * Every user rate is read by day: the one that started most recently on or before that day applies,
 * whatever the user's live-rate setting or base currency, and a day before the first rate has none.
 *
 * 1. A rate the user entered for exactly this pair wins.
 * 2. Otherwise each custom side is priced in the quote currency of the user's own rate for it, and
 *    the remaining ISO-to-ISO conversion goes through `resolveIsoRate` for the same day, so a manual
 *    ISO rate into the base wins and the market rate fills in otherwise.
 *
 * Custom rates keep their full precision: the 5-decimal market formatting would erase a coin worth
 * a fraction of a cent.
 */
export const resolveCustomPairRate = async ({
  userId,
  pair,
  date,
  isCustom,
  resolveIsoRate,
}: {
  userId: number;
  pair: { baseCode: string; quoteCode: string };
  date: Date;
  /** Whether a code is a custom currency, asked for the codes the user's rates quote as well. */
  isCustom: IsCustomCode;
  /** Resolves a pair of codes that are both ISO: it is never given a custom code. */
  resolveIsoRate: ResolveRate;
}): Promise<ResolvedRate> => {
  const exact = await UserExchangeRates.findOne({
    where: {
      userId,
      baseCode: pair.baseCode,
      quoteCode: pair.quoteCode,
      effectiveDate: { [Op.lte]: toEffectiveDate({ date }) },
    },
    order: [
      ['effectiveDate', 'DESC'],
      ['date', 'DESC'],
    ],
    raw: true,
  });
  if (exact) {
    return {
      baseCode: pair.baseCode,
      quoteCode: pair.quoteCode,
      date: new Date(exact.effectiveDate),
      rate: exact.rate,
      custom: true,
    };
  }

  const base = await priceInIsoCurrency({ userId, code: pair.baseCode, isCustom, date, pair });
  const quote = await priceInIsoCurrency({ userId, code: pair.quoteCode, isCustom, date, pair });

  const isoRate =
    base.code === quote.code ? 1 : (await resolveIsoRate({ baseCode: base.code, quoteCode: quote.code })).rate;

  // Decimal arithmetic, so chaining rates does not add binary floating-point noise.
  const rate = new Big(base.factor).times(isoRate).div(quote.factor).toNumber();

  return { ...pair, rate, date, custom: true };
};
