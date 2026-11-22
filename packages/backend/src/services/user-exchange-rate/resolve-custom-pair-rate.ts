import { t } from '@i18n/index';
import { ExchangeRateUnavailableError } from '@js/errors';
import UserExchangeRates, { toEffectiveDate } from '@models/user-exchange-rates.model';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';
import { findStoredCustomRate } from '@services/currencies/rate-sources/manual';
import { findPeg } from '@services/currencies/rate-sources/peg';
import { Op } from 'sequelize';

interface ResolvedRate {
  baseCode: string;
  quoteCode: string;
  date: Date;
  rate: number;
  custom?: boolean;
}

type ResolveRate = (params: { baseCode: string; quoteCode: string }) => Promise<ResolvedRate>;

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
 * What `findCustomCurrencyQuote` gives a custom code on every day of a range, read once: per
 * `YYYY-MM-DD` day, the ISO quote and the rate in it. `quoteCodes` lists every quote a day can take.
 * `null` without a rate.
 */
export const loadCustomCurrencyDailyQuote = async ({
  userId,
  code,
}: {
  userId: number;
  code: string;
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

  const earliest = rows.findLast((row) => row.effectiveDate === rows[0]!.effectiveDate)!;
  const storedQuotes = [...new Set(rows.map((row) => row.quoteCode))];
  const customQuotes = await findCustomCurrencyCodes({ codes: storedQuotes });

  return {
    quoteCodes: storedQuotes.filter((quote) => !customQuotes.has(quote)),
    quoteOn: (day) => {
      const row = rows.findLast((stored) => stored.effectiveDate <= day) ?? earliest;
      return customQuotes.has(row.quoteCode) ? null : { quoteCode: row.quoteCode, rate: row.rate };
    },
  };
};

/**
 * Rate of a pair with a custom side on the day of `date`, at full precision and outside the global
 * cross-rate cache: each custom side in its ISO currency, with the ISO leg left to `resolveIsoRate`
 * for the same day. An ISO-to-custom rate is the inverse of the custom-to-ISO one.
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
