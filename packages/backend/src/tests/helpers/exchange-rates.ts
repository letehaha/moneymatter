import { EXCHANGE_RATE_PROVIDER_TYPE, type ExchangeRatePairResponse } from '@bt/shared/types';
import { connection } from '@models/index';
import { getExchangeRatesForDate } from '@root/services/exchange-rates';
import { editUserExchangeRates, removeUserExchangeRates } from '@root/services/user-exchange-rate';
import { format, startOfDay } from 'date-fns';

import { makeRequest } from './common';

type ExchangeRatePair = {
  baseCode: string;
  quoteCode: string;
  rate: number;
};

export async function editCurrencyExchangeRate<R extends boolean | undefined = undefined>({
  pairs,
  raw,
}: {
  pairs: ExchangeRatePair[];
  raw?: R;
}) {
  const result = await makeRequest<Awaited<ReturnType<typeof editUserExchangeRates>>, R>({
    method: 'put',
    url: '/user/currency/rates',
    payload: { pairs },
    raw,
  });

  return result;
}

export async function removeCurrencyExchangeRate<R extends boolean | undefined = undefined>({
  pairs,
  raw,
}: {
  pairs: Omit<ExchangeRatePair, 'rate'>[];
  raw?: R;
}) {
  const result = await makeRequest<Awaited<ReturnType<typeof removeUserExchangeRates>>, R>({
    method: 'delete',
    url: '/user/currency/rates',
    payload: { pairs },
    raw,
  });

  return result;
}

export async function getExchangeRates<R extends boolean | undefined = undefined>({
  date,
  raw,
}: {
  date: string; // yyyy-mm-dd
  raw?: R;
}) {
  const response = await makeRequest<Awaited<ReturnType<typeof getExchangeRatesForDate>>, R>({
    method: 'get',
    url: `/currencies/rates/${date}`,
    raw,
  });

  return response;
}

export async function getExchangeRatePair<R extends boolean | undefined = undefined>({
  from,
  to,
  date,
  raw,
}: {
  from: string;
  to: string;
  date: string; // yyyy-mm-dd
  raw?: R;
}) {
  return makeRequest<ExchangeRatePairResponse, R>({
    method: 'get',
    url: '/currencies/rates/pair',
    payload: { from, to, date },
    raw,
  });
}

export async function syncExchangeRates() {
  return makeRequest<void>({
    url: '/tests/exchange-rates/sync',
    method: 'get',
  });
}

/**
 * `ExchangeRates` survives the between-test truncation and the global cleanup only
 * drops today and later, so past dates a test seeded must be cleared by the test.
 */
export async function clearExchangeRatesForDates({ dates }: { dates: Date[] }) {
  await connection.sequelize.query(`DELETE FROM "ExchangeRates" WHERE "date"::date = ANY(ARRAY[:days]::date[])`, {
    replacements: { days: dates.map((date) => format(date, 'yyyy-MM-dd')) },
  });
}

/**
 * Pin the market rates a test's date needs. Rate resolution reads USD-based rows
 * only, so quotes are given per USD; the `api-layer` source also marks the date
 * fully fetched, which keeps the providers out of the test.
 */
export async function seedUsdExchangeRates({ date, ratesPerUsd }: { date: Date; ratesPerUsd: Record<string, number> }) {
  const day = startOfDay(date);
  await clearExchangeRatesForDates({ dates: [day] });

  for (const [quoteCode, rate] of Object.entries(ratesPerUsd)) {
    await connection.sequelize.query(
      `INSERT INTO "ExchangeRates" ("baseCode", "quoteCode", "date", "rate", "source")
       VALUES ('USD', :quoteCode, :date, :rate, :source)`,
      { replacements: { quoteCode, date: day, rate, source: EXCHANGE_RATE_PROVIDER_TYPE.API_LAYER } },
    );
  }
}

// Powers of two so every cross-rate and every converted amount is exact.
export const AED_PER_USD = 4;
export const INR_PER_USD_AT_DEPOSIT = 64;
export const INR_PER_USD_AFTER = 128;
export const INR_TO_AED_AT_DEPOSIT = AED_PER_USD / INR_PER_USD_AT_DEPOSIT;
export const INR_TO_AED_AFTER = AED_PER_USD / INR_PER_USD_AFTER;

/** The INR/AED grid the foreign-currency history tests share: the rupee is worth
 *  half as much from the day after `depositDate` on. */
export async function seedInrAedRates({ depositDate, laterDates }: { depositDate: Date; laterDates: Date[] }) {
  await seedUsdExchangeRates({ date: depositDate, ratesPerUsd: { AED: AED_PER_USD, INR: INR_PER_USD_AT_DEPOSIT } });

  for (const date of laterDates) {
    await seedUsdExchangeRates({ date, ratesPerUsd: { AED: AED_PER_USD, INR: INR_PER_USD_AFTER } });
  }
}
