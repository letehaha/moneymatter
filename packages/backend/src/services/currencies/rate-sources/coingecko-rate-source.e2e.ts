/* eslint-disable @typescript-eslint/no-explicit-any */
import { type AccountApiResponse, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import Coingecko from '@coingecko/coingecko-typescript';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import { logger } from '@js/utils/logger';
import UserExchangeRates from '@models/user-exchange-rates.model';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { syncCoingeckoRates } from '@root/services/currencies/rate-sources/coingecko-sync';
import * as helpers from '@tests/helpers';
import { subDays } from 'date-fns';

/**
 * CoinGecko is never called for real: the SDK is mocked globally (setupIntegrationTests.ts) and each
 * test rebinds the three methods the rate source uses.
 */
const mockedCoingecko = jest.mocked(Coingecko);
const searchGet = jest.fn<any>();
const priceGet = jest.fn<any>();
const getRange = jest.fn<any>();

const installCoingeckoMock = () => {
  for (const mock of [searchGet, priceGet, getRange]) mock.mockReset();
  searchGet.mockResolvedValue({ coins: [] });
  priceGet.mockResolvedValue({});
  getRange.mockResolvedValue({ prices: [] });
  mockedCoingecko.mockImplementation(
    () =>
      ({
        search: { get: searchGet },
        simple: { price: { get: priceGet } },
        coins: { marketChart: { get: jest.fn<any>().mockResolvedValue({ prices: [] }), getRange } },
      }) as any,
  );
};

const BASE = (): string => global.BASE_CURRENCY_CODE;
const NEW_BASE = 'EUR';
const AED_PER_USD = 4;
const EUR_PER_USD = 0.5;

const dayKey = ({ daysAgo }: { daysAgo: number }): string => subDays(new Date(), daysAgo).toISOString().slice(0, 10);
const noonOf = ({ day }: { day: string }): string => `${day}T12:00:00.000Z`;

// Distinct, recent days that no other suite seeds.
const DAY_1 = dayKey({ daysAgo: 33 });
const DAY_2 = dayKey({ daysAgo: 32 });
const DAY_3 = dayKey({ daysAgo: 31 });
const BEFORE_HISTORY = dayKey({ daysAgo: 40 });
const TODAY = dayKey({ daysAgo: 0 });
const SEEDED_DAYS = [BEFORE_HISTORY, DAY_1, DAY_2, DAY_3];

/** The `[timestamp, price]` points of a daily series, as CoinGecko returns them (00:00 UTC). */
const seriesOf = (entries: [day: string, price: number][]) =>
  entries.map(([day, price]) => [Date.parse(`${day}T00:00:00.000Z`), price]);

const history = (entries: [day: string, price: number][]) => ({ prices: seriesOf(entries) });

const createCurrency = async ({ code, decimals = 8 }: { code: string; decimals?: number }) => {
  const response = await helpers.createCustomCurrency({ payload: { code, name: code, decimals } });
  expect(response.statusCode).toBe(201);
};

const useCoingecko = ({
  code,
  coinId = 'bitcoin',
  quoteCurrency,
}: {
  code: string;
  coinId?: string;
  quoteCurrency?: string;
}) =>
  helpers.setCurrencyRateSource({
    code,
    payload: { rateSource: 'coingecko', config: { coinId, ...(quoteCurrency ? { quoteCurrency } : {}) } },
  });

const createAccountIn = async ({ code }: { code: string }) => {
  const response = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: code, name: `${code} account`, initialBalance: 0 }),
    raw: false,
  });
  expect(response.statusCode).toBe(200);

  return (response as unknown as { body: { response: AccountApiResponse } }).body.response;
};

const createTx = async ({ accountId, amount, day }: { accountId: string; amount: number; day: string }) => {
  const response = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: accountId as RecordId,
      amount,
      categoryId: global.DEFAULT_CATEGORY_ID,
      transactionType: TRANSACTION_TYPES.expense,
      time: noonOf({ day }),
    }),
    raw: false,
  });
  const body = response as unknown as { statusCode: number; body: { response: TransactionApiResponse[] } };
  if (body.statusCode !== 200) throw new Error(`createTransaction answered ${body.statusCode}`);

  return body.body.response[0]!;
};

const readTx = async ({ id }: { id: string }) =>
  (await helpers.getTransactionById({ id: id as RecordId, raw: true })) as unknown as TransactionApiResponse;

const readAccount = async ({ id }: { id: string }) =>
  (await helpers.getAccount({ id, raw: true })) as unknown as AccountApiResponse;

const storedRates = async ({ code }: { code: string }) => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });
  const rows = await UserExchangeRates.findAll({ where: { userId, baseCode: code }, raw: true });

  return rows
    .map((row) => ({ day: row.effectiveDate, quote: row.quoteCode, rate: Number(row.rate), source: row.source }))
    .toSorted((a, b) => a.day.localeCompare(b.day));
};

describe('CoinGecko rate source', () => {
  beforeEach(async () => {
    installCoingeckoMock();
    await helpers.addUserCurrencies({ currencyCodes: ['USD', NEW_BASE], raw: true });
    for (const day of SEEDED_DAYS) {
      await helpers.seedUsdExchangeRates({
        date: new Date(`${day}T00:00:00.000Z`),
        ratesPerUsd: { AED: AED_PER_USD, EUR: EUR_PER_USD },
      });
    }
  });

  afterEach(async () => {
    await helpers.clearExchangeRatesForDates({ dates: SEEDED_DAYS.map((day) => new Date(`${day}T00:00:00.000Z`)) });
  });

  describe('GET /user/currencies/coingecko/search', () => {
    it('lists the canonical coins that match, without wrapped copies', async () => {
      searchGet.mockResolvedValue({
        coins: [
          {
            id: 'bitcoin',
            symbol: 'btc',
            name: 'Bitcoin',
            large: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
            market_cap_rank: 1,
          },
          { id: 'wrapped-bitcoin', symbol: 'wbtc', name: 'Wrapped Bitcoin', market_cap_rank: 15 },
        ],
      });

      const response = await helpers.searchCoingeckoCoins({ query: 'btc', raw: false });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual([
        {
          coinId: 'bitcoin',
          symbol: 'BTC',
          name: 'Bitcoin',
          logoUrl: 'https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png',
          marketCapRank: 1,
        },
      ]);
      expect(searchGet).toHaveBeenCalledWith({ query: 'btc' });
    });

    it('answers an empty list when nothing matches', async () => {
      const response = await helpers.searchCoingeckoCoins({ query: 'nothing-like-this', raw: false });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual([]);
    });

    it('rejects a blank query', async () => {
      const response = await helpers.searchCoingeckoCoins({ query: '   ', raw: false });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(searchGet).not.toHaveBeenCalled();
    });

    it('answers 503 on an instance without a CoinGecko key', async () => {
      const key = process.env.COINGECKO_API_KEY;
      delete process.env.COINGECKO_API_KEY;
      try {
        const response = await helpers.searchCoingeckoCoins({ query: 'btc', raw: false });

        expect(response.statusCode).toBe(ERROR_CODES.ServiceUnavailable);
      } finally {
        process.env.COINGECKO_API_KEY = key;
      }
    });
  });

  describe('configuring the source', () => {
    it('backfills the history and values the transactions that were waiting for a rate', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      const waiting = await createTx({ accountId: account.id, amount: 0.5, day: DAY_2 });
      const beforeHistory = await createTx({ accountId: account.id, amount: 1, day: BEFORE_HISTORY });
      expect(waiting.refAmount).toBeNull();
      expect(waiting.refAmountMissing).toBe(true);

      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
          [DAY_3, 30],
        ]),
      );
      const response = await useCoingecko({ code: 'BTC' });

      expect(response.statusCode).toBe(200);
      expect(response.body.response).toEqual({
        currencyCode: 'BTC',
        rateSource: 'coingecko',
        rateSourceConfig: { coinId: 'bitcoin', quoteCurrency: 'USD' },
      });
      expect(getRange).toHaveBeenCalledTimes(1);
      expect(getRange).toHaveBeenCalledWith('bitcoin', expect.objectContaining({ vs_currency: 'usd' }));
      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 10, source: 'coingecko' },
        { day: DAY_2, quote: 'USD', rate: 20, source: 'coingecko' },
        { day: DAY_3, quote: 'USD', rate: 30, source: 'coingecko' },
      ]);

      // 0.5 BTC at 20 USD, crossed into the base at the market rate of the day.
      const valued = await readTx({ id: waiting.id });
      expect(valued.refAmount).toBe(0.5 * 20 * AED_PER_USD);
      expect(valued.refAmountMissing).toBe(false);
      // A day before the first rate has no rate to use.
      const stillWaiting = await readTx({ id: beforeHistory.id });
      expect(stillWaiting.refAmount).toBeNull();
      expect(stillWaiting.refAmountMissing).toBe(true);
      // The account's balance follows the latest rate, whatever the unpriced row's date.
      expect((await readAccount({ id: account.id })).refCurrentBalance).not.toBeNull();

      const next = await createTx({ accountId: account.id, amount: 1, day: DAY_3 });
      expect(next.refAmount).toBe(30 * AED_PER_USD);
    });

    it('keeps the source and logs when the backfill fails, and the daily sync fills the history in', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      const tx = await createTx({ accountId: account.id, amount: 2, day: DAY_2 });

      getRange.mockRejectedValue(new Error('CoinGecko is down'));
      const errorSpy = jest.spyOn(logger, 'error');
      try {
        const response = await useCoingecko({ code: 'BTC' });

        expect(response.statusCode).toBe(200);
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ message: expect.stringContaining('CoinGecko backfill failed for BTC') }),
          { code: 'COINGECKO_RATE_BACKFILL_FAILED' },
        );
      } finally {
        errorSpy.mockRestore();
      }
      expect(await storedRates({ code: 'BTC' })).toEqual([]);
      expect((await readTx({ id: tx.id })).refAmountMissing).toBe(true);

      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
          [DAY_3, 30],
        ]),
      );
      const result = await syncCoingeckoRates({ spacingMs: 0 });

      expect(result).toEqual({ coinsFetched: 1, currenciesUpdated: 1, ratesWritten: 3, failures: 0 });
      expect(priceGet).not.toHaveBeenCalled();
      expect((await readTx({ id: tx.id })).refAmount).toBe(2 * 20 * AED_PER_USD);
    });

    it('answers 503 and saves nothing on an instance without a CoinGecko key', async () => {
      await createCurrency({ code: 'BTC' });

      const key = process.env.COINGECKO_API_KEY;
      delete process.env.COINGECKO_API_KEY;
      try {
        const response = await useCoingecko({ code: 'BTC' });

        expect(response.statusCode).toBe(ERROR_CODES.ServiceUnavailable);
      } finally {
        process.env.COINGECKO_API_KEY = key;
      }
      const entry = (await helpers.getUserCurrencies()).find((item) => item.currencyCode === 'BTC');
      expect(entry?.rateSource).toBe('manual');
      expect(getRange).not.toHaveBeenCalled();
    });

    it('does not fetch again when the same source is saved twice', async () => {
      await createCurrency({ code: 'BTC' });
      getRange.mockResolvedValue(history([[DAY_1, 10]]));

      await useCoingecko({ code: 'BTC' });
      await useCoingecko({ code: 'BTC' });

      expect(getRange).toHaveBeenCalledTimes(1);
    });

    it('leaves a rate the user set by hand alone and replaces the history of another coin', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      const edit = await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: 'BTC', quoteCode: 'USD', rate: 99, effectiveDate: DAY_1 },
          { baseCode: 'USD', quoteCode: 'BTC', rate: 1 / 99, effectiveDate: DAY_1 },
        ],
        raw: true,
      });
      expect(edit).toBeDefined();

      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
        ]),
      );
      await useCoingecko({ code: 'BTC' });
      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 99, source: 'manual' },
        { day: DAY_2, quote: 'USD', rate: 20, source: 'coingecko' },
      ]);

      getRange.mockResolvedValue(
        history([
          [DAY_2, 500],
          [DAY_3, 600],
        ]),
      );
      await useCoingecko({ code: 'BTC', coinId: 'ethereum' });

      // The old coin's day is gone, the manual one stays, and the new coin's days replace the rest.
      expect(await storedRates({ code: 'BTC' })).toEqual([
        { day: DAY_1, quote: 'USD', rate: 99, source: 'manual' },
        { day: DAY_2, quote: 'USD', rate: 500, source: 'coingecko' },
        { day: DAY_3, quote: 'USD', rate: 600, source: 'coingecko' },
      ]);
      const tx = await createTx({ accountId: account.id, amount: 1, day: DAY_3 });
      expect(tx.refAmount).toBe(600 * AED_PER_USD);
    });
  });

  describe('daily sync', () => {
    it('adds the rate of a new day without touching what was valued on earlier days', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
          [DAY_3, 30],
        ]),
      );
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });

      const earlier = await createTx({ accountId: account.id, amount: 1, day: DAY_2 });
      // Today has no rate yet, so the latest earlier one prices it.
      const today = await createTx({ accountId: account.id, amount: 1, day: TODAY });
      expect(earlier.refAmount).toBe(20);
      expect(today.refAmount).toBe(30);

      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 50 } });
      const result = await syncCoingeckoRates({ spacingMs: 0 });

      expect(result).toEqual({ coinsFetched: 1, currenciesUpdated: 1, ratesWritten: 1, failures: 0 });
      expect(priceGet).toHaveBeenCalledTimes(1);
      expect(priceGet).toHaveBeenCalledWith(
        expect.objectContaining({ ids: 'bitcoin', vs_currencies: BASE().toLowerCase() }),
      );
      expect(getRange).toHaveBeenCalledTimes(1);
      expect((await storedRates({ code: 'BTC' })).at(-1)).toEqual({
        day: TODAY,
        quote: BASE(),
        rate: 50,
        source: 'coingecko',
      });

      // A new rate for a new day never reaches rows that already hold an amount.
      expect((await readTx({ id: earlier.id })).refAmount).toBe(20);
      expect((await readTx({ id: today.id })).refAmount).toBe(30);
      const later = await createTx({ accountId: account.id, amount: 1, day: TODAY });
      expect(later.refAmount).toBe(50);
    });

    it('values a day again when the sync finds another price for it', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(history([[DAY_1, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });

      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 50 } });
      await syncCoingeckoRates({ spacingMs: 0 });
      const tx = await createTx({ accountId: account.id, amount: 2, day: TODAY });
      expect(tx.refAmount).toBe(100);

      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 60 } });
      const result = await syncCoingeckoRates({ spacingMs: 0 });

      expect(result.ratesWritten).toBe(1);
      expect((await readTx({ id: tx.id })).refAmount).toBe(120);
      expect((await storedRates({ code: 'BTC' })).filter((rate) => rate.day === TODAY)).toHaveLength(1);

      // The same price again changes nothing.
      expect((await syncCoingeckoRates({ spacingMs: 0 })).ratesWritten).toBe(0);
    });

    it('fetches a coin once for all the currencies that take it', async () => {
      await createCurrency({ code: 'BTC' });
      await createCurrency({ code: 'WBTC' });
      getRange.mockResolvedValue(history([[DAY_1, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });
      await useCoingecko({ code: 'WBTC', quoteCurrency: BASE() });
      priceGet.mockResolvedValue({ bitcoin: { [BASE().toLowerCase()]: 70 } });

      const result = await syncCoingeckoRates({ spacingMs: 0 });

      expect(priceGet).toHaveBeenCalledTimes(1);
      expect(priceGet).toHaveBeenCalledWith(expect.objectContaining({ ids: 'bitcoin' }));
      // One coin was fetched for the two currencies that take it.
      expect(result).toEqual({ coinsFetched: 1, currenciesUpdated: 2, ratesWritten: 2, failures: 0 });
      for (const code of ['BTC', 'WBTC']) {
        expect((await storedRates({ code })).at(-1)).toEqual({
          day: TODAY,
          quote: BASE(),
          rate: 70,
          source: 'coingecko',
        });
      }
    });

    it('keeps the last rate and logs when the price call fails', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_3, 30],
        ]),
      );
      await useCoingecko({ code: 'BTC', quoteCurrency: BASE() });
      const tx = await createTx({ accountId: account.id, amount: 1, day: TODAY });
      expect(tx.refAmount).toBe(30);
      const ratesBefore = await storedRates({ code: 'BTC' });

      priceGet.mockRejectedValue(new Error('CoinGecko is down'));
      const errorSpy = jest.spyOn(logger, 'error');
      try {
        const result = await syncCoingeckoRates({ spacingMs: 0 });

        expect(result).toEqual({ coinsFetched: 0, currenciesUpdated: 0, ratesWritten: 0, failures: 1 });
        expect(errorSpy).toHaveBeenCalledWith(
          expect.objectContaining({ message: expect.stringContaining('the last rates stay in force') }),
          { code: 'COINGECKO_RATE_SYNC_FAILED' },
        );
      } finally {
        errorSpy.mockRestore();
      }

      expect(await storedRates({ code: 'BTC' })).toEqual(ratesBefore);
      expect((await readTx({ id: tx.id })).refAmount).toBe(30);
      const next = await createTx({ accountId: account.id, amount: 1, day: TODAY });
      expect(next.refAmount).toBe(30);
    });

    it('stops the run on a rate limit instead of calling on', async () => {
      await createCurrency({ code: 'BTC' });
      await createCurrency({ code: 'ETH' });
      getRange.mockResolvedValue(history([[DAY_1, 10]]));
      await useCoingecko({ code: 'BTC', quoteCurrency: 'USD' });
      await useCoingecko({ code: 'ETH', coinId: 'ethereum', quoteCurrency: BASE() });
      priceGet.mockRejectedValue(Object.assign(new Error('Too many requests'), { status: 429 }));

      const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => logger);
      try {
        const result = await syncCoingeckoRates({ spacingMs: 0 });

        // Two quote currencies mean two batches; the second is not asked after the 429.
        expect(priceGet).toHaveBeenCalledTimes(1);
        expect(result.failures).toBe(1);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('does nothing when no currency uses CoinGecko', async () => {
      await createCurrency({ code: 'BTC' });

      expect(await syncCoingeckoRates({ spacingMs: 0 })).toEqual({
        coinsFetched: 0,
        currenciesUpdated: 0,
        ratesWritten: 0,
        failures: 0,
      });
      expect(getRange).not.toHaveBeenCalled();
      expect(priceGet).not.toHaveBeenCalled();
    });
  });

  describe('changing the base currency', () => {
    it('crosses the stored quote into the new base without fetching again', async () => {
      await createCurrency({ code: 'BTC' });
      const account = await createAccountIn({ code: 'BTC' });
      getRange.mockResolvedValue(
        history([
          [DAY_1, 10],
          [DAY_2, 20],
          [DAY_3, 30],
        ]),
      );
      await useCoingecko({ code: 'BTC' });
      const tx = await createTx({ accountId: account.id, amount: 0.5, day: DAY_2 });
      expect(tx.refAmount).toBe(0.5 * 20 * AED_PER_USD);
      const ratesBefore = await storedRates({ code: 'BTC' });
      getRange.mockClear();
      priceGet.mockClear();

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE });
      helpers.expectBaseCurrencyChangeCompleted(status);

      const after = await readTx({ id: tx.id });
      expect(after.refCurrencyCode).toBe(NEW_BASE);
      expect(after.refAmount).toBe(0.5 * 20 * EUR_PER_USD);
      expect(after.refAmountMissing).toBe(false);
      expect(getRange).not.toHaveBeenCalled();
      expect(priceGet).not.toHaveBeenCalled();
      expect(await storedRates({ code: 'BTC' })).toEqual(ratesBefore);

      const next = await createTx({ accountId: account.id, amount: 1, day: DAY_3 });
      expect(next.refAmount).toBe(30 * EUR_PER_USD);
    }, 60000);
  });
});
