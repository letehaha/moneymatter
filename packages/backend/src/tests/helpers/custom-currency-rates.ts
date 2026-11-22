/* eslint-disable @typescript-eslint/no-explicit-any */
import { type AccountApiResponse, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import Coingecko from '@coingecko/coingecko-typescript';
import { expect, jest } from '@jest/globals';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import type { syncCoingeckoRates } from '@root/services/currencies/rate-sources/coingecko-sync';
import type { syncHttpRates } from '@root/services/currencies/rate-sources/http-sync';
import { subDays } from 'date-fns';

import { buildAccountPayload, createAccount } from './account';
import { makeRequest } from './common';
import { createCustomCurrency, getCurrencyRateHistory, getUserCurrencies, setCurrencyRateSource } from './currencies';
import { editCurrencyExchangeRate, getExchangeRatePair, removeCurrencyExchangeRate } from './exchange-rates';
import { buildTransactionPayload, createTransaction, getTransactionById } from './transactions';

/** The UTC calendar day `daysAgo` days before now; a negative value is a later day. */
export const dayKey = ({ daysAgo }: { daysAgo: number }): string =>
  subDays(new Date(), daysAgo).toISOString().slice(0, 10);

export const noonOf = ({ day }: { day: string }): string => `${day}T12:00:00.000Z`;

/** A custom currency on manual rates, worth `rate` of `quote` (the base currency unless given) from today on. */
export const addCustomCurrency = async ({
  code,
  decimals = 6,
  rate = 1,
  quote,
}: {
  code: string;
  decimals?: number;
  rate?: number;
  quote?: string;
}) => {
  const response = await createCustomCurrency({
    payload: { code, name: code, decimals, rate: { value: rate, ...(quote && { quoteCode: quote }) } },
  });
  expect(response.statusCode).toBe(201);
};

/** Both directions of a manual rate, as the endpoint requires; only the custom-to-ISO one is stored. */
export const userRatePairs = ({
  code,
  quote = global.BASE_CURRENCY_CODE,
  rate,
  effectiveDate,
}: {
  code: string;
  quote?: string;
  rate: number;
  effectiveDate?: string;
}) => [
  { baseCode: code, quoteCode: quote, rate, effectiveDate },
  { baseCode: quote, quoteCode: code, rate: 1 / rate, effectiveDate },
];

export const setUserRate = async (params: Parameters<typeof userRatePairs>[0]) => {
  const response = await editCurrencyExchangeRate({ pairs: userRatePairs(params) });
  expect(response.statusCode).toBe(200);

  return response.body.response;
};

export const removeUserRate = async ({
  code,
  quote = global.BASE_CURRENCY_CODE,
  effectiveDate,
}: {
  code: string;
  quote?: string;
  effectiveDate?: string;
}) => {
  const response = await removeCurrencyExchangeRate({
    pairs: [
      { baseCode: code, quoteCode: quote, effectiveDate },
      { baseCode: quote, quoteCode: code, effectiveDate },
    ],
  });
  expect(response.statusCode).toBe(200);
};

/**
 * A custom currency whose only rate is `openingRate` in the base currency from `openingDay` on, so
 * the days after it are free for the rates a test stores.
 */
export const addCustomCurrencyFrom = async ({
  code,
  decimals = 6,
  openingDay,
  openingRate,
}: {
  code: string;
  decimals?: number;
  openingDay: string;
  openingRate: number;
}) => {
  await addCustomCurrency({ code, decimals, rate: openingRate });
  const [created] = (await getCurrencyRateHistory({ code, raw: true })).items;
  await setUserRate({ code, rate: openingRate, effectiveDate: openingDay });
  await removeUserRate({ code, quote: created!.quoteCode, effectiveDate: created!.effectiveDate });
};

export const pegTo = async ({
  code,
  pegCurrency,
  factor = 1,
}: {
  code: string;
  pegCurrency: string;
  factor?: number;
}) => {
  const response = await setCurrencyRateSource({
    code,
    payload: { rateSource: 'peg', config: { pegCurrency, factor } },
  });
  expect(response.statusCode).toBe(200);
};

export const savedSource = async ({ code }: { code: string }) => {
  const entry = (await getUserCurrencies()).find((item) => item.currencyCode === code);

  return { rateSource: entry?.rateSource, rateSourceConfig: entry?.rateSourceConfig };
};

/** The stored rates of a custom currency from the rate-history endpoint, earliest day first. */
export const storedRates = async ({ code, excludeDay }: { code: string; excludeDay?: string }) => {
  const { items } = await getCurrencyRateHistory({ code, limit: 100, raw: true });

  return items
    .filter((item) => item.effectiveDate !== excludeDay)
    .map((item) => ({ day: item.effectiveDate, quote: item.quoteCode, rate: item.rate, source: item.source }))
    .toSorted((a, b) => a.day.localeCompare(b.day));
};

export const rateValueOn = async ({ from, to, day }: { from: string; to: string; day: string }) => {
  const response = await getExchangeRatePair({ from, to, date: day });
  expect(response.statusCode).toBe(200);

  return response.body.response.rate;
};

export const createAccountInCurrency = async ({
  code,
  initialBalance = 0,
}: {
  code: string;
  initialBalance?: number;
}) => {
  const response = await createAccount({
    payload: buildAccountPayload({ currencyCode: code, name: `${code} account`, initialBalance }),
    raw: false,
  });
  expect(response.statusCode).toBe(200);

  return (response as unknown as { body: { response: AccountApiResponse } }).body.response;
};

/** Creates a transaction at noon UTC of `day` (today unless given); a transfer answers both legs. */
export const createTxOn = async ({
  accountId,
  amount,
  day = dayKey({ daysAgo: 0 }),
  type = TRANSACTION_TYPES.expense,
  extra = {},
}: {
  accountId: string;
  amount: number;
  day?: string;
  type?: TRANSACTION_TYPES;
  extra?: Partial<Parameters<typeof buildTransactionPayload>[0]>;
}) => {
  const response = await createTransaction({
    payload: buildTransactionPayload({
      accountId: accountId as RecordId,
      amount,
      categoryId: global.DEFAULT_CATEGORY_ID,
      transactionType: type,
      time: noonOf({ day }),
      ...extra,
    }),
    raw: false,
  });
  const result = response as unknown as { statusCode: number; body: { response: TransactionApiResponse[] } };
  if (result.statusCode !== 200) throw new Error(`createTransaction answered ${result.statusCode}`);

  return result.body.response;
};

export const readTx = async ({ id }: { id: string }) =>
  (await getTransactionById({ id, raw: true })) as TransactionApiResponse;

/**
 * The CoinGecko SDK is mocked globally (setupIntegrationTests.ts); these are the methods a rate
 * source calls, rebound by {@link resetCoingeckoMock} before each test.
 */
export const coingeckoMock = {
  searchGet: jest.fn<any>(),
  priceGet: jest.fn<any>(),
  getRange: jest.fn<any>(),
};

export const resetCoingeckoMock = () => {
  const { searchGet, priceGet, getRange } = coingeckoMock;
  for (const mock of [searchGet, priceGet, getRange]) mock.mockReset();
  searchGet.mockResolvedValue({ coins: [] });
  priceGet.mockResolvedValue({});
  getRange.mockResolvedValue({ prices: [] });
  jest.mocked(Coingecko).mockImplementation(
    () =>
      ({
        search: { get: searchGet },
        simple: { price: { get: priceGet } },
        coins: { marketChart: { get: jest.fn<any>().mockResolvedValue({ prices: [] }), getRange } },
      }) as any,
  );
};

/** `[timestamp, price]` points of a daily series, as CoinGecko returns them (00:00 UTC). */
export const coingeckoHistory = (entries: [day: string, price: number][]) => ({
  prices: entries.map(([day, price]) => [Date.parse(`${day}T00:00:00.000Z`), price]),
});

type RateSourceSyncResult = {
  coingecko: Awaited<ReturnType<typeof syncCoingeckoRates>>;
  http: Awaited<ReturnType<typeof syncHttpRates>>;
};

/** Runs the daily sync of every user's `source` currencies, as the cron does. */
export const syncRateSources = async <S extends keyof RateSourceSyncResult>({ source }: { source: S }) => {
  const response = await makeRequest<RateSourceSyncResult[S]>({
    method: 'get',
    url: '/tests/currency-rate-sources/sync',
    payload: { source },
  });
  expect(response.statusCode).toBe(200);

  return response.body.response;
};
