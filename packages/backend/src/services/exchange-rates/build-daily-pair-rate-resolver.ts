import { connection } from '@models/connection';
import { buildUsdRateLookup } from '@services/stats/build-usd-rate-lookup';
import { createFindLatestUsdRate } from '@services/stats/get-combined-balance-history/exchange-rate-lookup';
import { QueryTypes, Transaction as SequelizeTransaction } from 'sequelize';

import { API_LAYER_BASE_CURRENCY_CODE } from './constants';

export const MS_PER_DAY = 86_400_000;

/** Same rounding `getExchangeRate` applies, so a resolved rate matches what every other
 *  conversion in the app produces for that day. Significant digits, not fixed decimals,
 *  because rates like IRR->USD sit near 5e-7. */
export const formatRate = (rate: number) => Number(rate.toPrecision(12));

/** UTC calendar day of a timestamp, or the day part of a `DATEONLY` string. */
export const toDayKey = (date: Date | string): string =>
  typeof date === 'string' ? date.slice(0, 10) : date.toISOString().slice(0, 10);

export type DailyPairRateResolver = (dayKey: string) => number | null;

/**
 * Per-day `baseCode → quoteCode` rate from the USD-pivot rows: exact day, else the
 * most recent earlier day, else the earliest day known for that currency.
 *
 * Returns `null` when either leg has no stored rate dated on or before `to`. The
 * resolver returns `null` only for a day whose rate is zero.
 */
export const buildDailyPairRateResolver = async ({
  baseCode,
  quoteCode,
  from,
  to,
  transaction,
}: {
  baseCode: string;
  quoteCode: string;
  from: Date;
  to: Date;
  transaction?: SequelizeTransaction;
}): Promise<DailyPairRateResolver | null> => {
  const quoteCodes = [baseCode, quoteCode];

  const systemRates = (await connection.sequelize.query(
    `SELECT "quoteCode", "date", "rate"
       FROM "ExchangeRates"
      WHERE "baseCode" = :pivotCode AND "quoteCode" IN (:quoteCodes) AND "date" >= :from AND "date" < :toExclusive
      ORDER BY "quoteCode", "date" ASC`,
    {
      type: QueryTypes.SELECT,
      replacements: {
        pivotCode: API_LAYER_BASE_CURRENCY_CODE,
        quoteCodes,
        from,
        toExclusive: new Date(+to + MS_PER_DAY),
      },
      transaction,
    },
  )) as { quoteCode: string; date: Date; rate: number }[];

  const { usdRatesMap, usdRateDatesByQuote } = await buildUsdRateLookup({
    systemRates,
    quoteCodes,
    windowStart: toDayKey(from),
  });
  const findLatestUsdRate = createFindLatestUsdRate({ usdRatesMap, usdRateDatesByQuote });

  // A leg whose only rate is dated after the window counts as uncovered, so callers
  // resolve each row's own date instead of writing one borrowed rate to every row.
  const lastDayKey = toDayKey(to);
  const hasRateInRange = (code: string) => {
    if (code === API_LAYER_BASE_CURRENCY_CODE) return true;
    const earliest = usdRateDatesByQuote.get(code)?.[0];
    return earliest !== undefined && earliest <= lastDayKey;
  };

  if (!hasRateInRange(baseCode) || !hasRateInRange(quoteCode)) return null;

  return (dayKey: string) => {
    const usdToBase = findLatestUsdRate(baseCode, dayKey);
    const usdToQuote = findLatestUsdRate(quoteCode, dayKey);
    if (!usdToBase || !usdToQuote || usdToBase.rate === 0) return null;

    // A zero rate would be written as a valid history of zero balances.
    const rate = formatRate(usdToQuote.rate / usdToBase.rate);
    return rate > 0 ? rate : null;
  };
};
