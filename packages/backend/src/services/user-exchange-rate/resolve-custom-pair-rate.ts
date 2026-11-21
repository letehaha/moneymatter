import type { CurrencyRateSource } from '@bt/shared/types';
import { t } from '@i18n/index';
import { ExchangeRateUnavailableError } from '@js/errors';
import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import UsersCurrencies from '@models/users-currencies.model';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';
import { findStoredCustomRate, findStoredPairRate } from '@services/currencies/rate-sources/manual';
import { findPeg } from '@services/currencies/rate-sources/peg';
import { Op } from 'sequelize';

interface ResolvedRate {
  baseCode: string;
  quoteCode: string;
  date: Date;
  rate: number;
  custom?: boolean;
}

/** The sources whose own rates value a currency: a stored rate for an exact pair never overrides them. */
const SOURCE_OWNED_RATE_SOURCES = ['peg', 'coingecko', 'http'] as const satisfies readonly CurrencyRateSource[];

type ResolveRate = (params: { baseCode: string; quoteCode: string }) => Promise<ResolvedRate>;

/** Whether a rate source is a peg or a synced one, which price a currency instead of the user's own entries. */
const isSourceOwnedRateSource = ({ rateSource }: { rateSource: string }): boolean =>
  (SOURCE_OWNED_RATE_SOURCES as readonly string[]).includes(rateSource);

/** Whether the user's rates for a custom code come from a peg or from a synced source, not from their own entries. */
const followsASource = async ({ userId, code }: { userId: number; code: string }): Promise<boolean> => {
  const held = await UsersCurrencies.findOne({
    where: { userId, currencyCode: code },
    attributes: ['rateSource'],
    raw: true,
  });

  return held ? isSourceOwnedRateSource({ rateSource: held.rateSource }) : false;
};

/**
 * One unit of the user's custom code in an ISO currency on the day of `date`: its peg, else its stored
 * rate in force that day (the earliest one before its first). `null` without a rate or with a custom quote.
 */
export const findCustomCurrencyQuote = async ({
  userId,
  code,
  date,
}: {
  userId: number;
  code: string;
  date: Date;
}): Promise<{ quoteCode: string; rate: number } | null> => {
  const peg = await findPeg({ userId, code });
  const quote = peg
    ? { quoteCode: peg.quoteCode, rate: peg.factor }
    : await findStoredCustomRate({ userId, baseCode: code, asOfDate: toEffectiveDate({ date }) });
  if (!quote) return null;
  if ((await findCustomCurrencyCodes({ codes: [quote.quoteCode] })).size) return null;

  return { quoteCode: quote.quoteCode, rate: quote.rate };
};

interface CustomCurrencyDailyQuote {
  quoteCodes: string[];
  quoteOn: (day: string) => { quoteCode: string; rate: number } | null;
}

/**
 * What `resolveCustomPairRate` picks for the pair of a custom code and an ISO `targetCode` on every
 * day of a range, read once: per `YYYY-MM-DD` day, the ISO quote and the rate in it (the exact pair
 * gives `targetCode` itself). `quoteCodes` lists every quote a day can take. `null` without a rate.
 */
export const loadCustomCurrencyDailyQuote = async ({
  userId,
  code,
  targetCode,
}: {
  userId: number;
  code: string;
  targetCode: string;
}): Promise<CustomCurrencyDailyQuote | null> => {
  const peg = await findPeg({ userId, code });
  if (peg) return { quoteCodes: [peg.quoteCode], quoteOn: () => ({ quoteCode: peg.quoteCode, rate: peg.factor }) };

  const rows = await UserExchangeRates.findAll({
    where: { userId, baseCode: code, rate: { [Op.gt]: 0 } },
    attributes: ['quoteCode', 'rate', 'effectiveDate'],
    order: [
      ['effectiveDate', 'ASC'],
      ['date', 'ASC'],
    ],
    raw: true,
  });
  if (!rows.length) return null;

  const exactPair = (await followsASource({ userId, code })) ? [] : rows.filter((row) => row.quoteCode === targetCode);
  const earliest = rows.findLast((row) => row.effectiveDate === rows[0]!.effectiveDate)!;
  const storedQuotes = [...new Set(rows.map((row) => row.quoteCode))];
  const customQuotes = await findCustomCurrencyCodes({ codes: storedQuotes });

  return {
    quoteCodes: storedQuotes.filter((quote) => !customQuotes.has(quote)),
    quoteOn: (day) => {
      const exact = exactPair.findLast((row) => row.effectiveDate <= day);
      if (exact) return { quoteCode: exact.quoteCode, rate: exact.rate };

      const row = rows.findLast((stored) => stored.effectiveDate <= day) ?? earliest;
      return customQuotes.has(row.quoteCode) ? null : { quoteCode: row.quoteCode, rate: row.rate };
    },
  };
};

/**
 * Rate of a pair with a custom side on the day of `date`, at full precision and outside the global
 * cross-rate cache: the user's exact-pair rate (unless a side follows a peg or a synced source), else
 * each custom side in its ISO currency, with the ISO leg left to `resolveIsoRate` for the same day.
 */
export const resolveCustomPairRate = async ({
  userId,
  pair,
  date,
  resolveIsoRate,
}: {
  userId: number;
  pair: { baseCode: string; quoteCode: string };
  date: Date;
  /** Resolves a pair of codes that are both ISO: it is never given a custom code. */
  resolveIsoRate: ResolveRate;
}): Promise<ResolvedRate> => {
  const customCodes = await findCustomCurrencyCodes({ codes: [pair.baseCode, pair.quoteCode] });

  const sidesFollowingASource = await Promise.all([...customCodes].map((code) => followsASource({ userId, code })));
  const exact = sidesFollowingASource.some(Boolean)
    ? null
    : await findStoredPairRate({
        userId,
        baseCode: pair.baseCode,
        quoteCode: pair.quoteCode,
        asOfDate: toEffectiveDate({ date }),
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

  const priceInIsoCurrency = async ({ code }: { code: string }) => {
    if (!customCodes.has(code)) return { quoteCode: code, rate: 1 };

    const quote = await findCustomCurrencyQuote({ userId, code, date });
    if (!quote) {
      throw new ExchangeRateUnavailableError({
        message: t({
          key: 'currencies.exchangeRateNotAvailable',
          variables: { baseCode: pair.baseCode, quoteCode: pair.quoteCode, date: date.toISOString() },
        }),
      });
    }
    return quote;
  };

  const base = await priceInIsoCurrency({ code: pair.baseCode });
  const quote = await priceInIsoCurrency({ code: pair.quoteCode });

  const isoRate =
    base.quoteCode === quote.quoteCode
      ? 1
      : (await resolveIsoRate({ baseCode: base.quoteCode, quoteCode: quote.quoteCode })).rate;

  const rate = (base.rate * isoRate) / quote.rate;

  return { ...pair, rate, date, custom: true };
};
