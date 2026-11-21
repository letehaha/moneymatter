/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CurrencyRateHistoryItem } from '@bt/shared/types';
import Coingecko from '@coingecko/coingecko-typescript';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { addDays, subDays } from 'date-fns';

/**
 * CoinGecko is never called for real: the SDK is mocked globally (setupIntegrationTests.ts) and each
 * test rebinds the methods the rate source uses.
 */
const mockedCoingecko = jest.mocked(Coingecko);
const getRange = jest.fn<any>();

const installCoingeckoMock = () => {
  getRange.mockReset();
  getRange.mockResolvedValue({ prices: [] });
  mockedCoingecko.mockImplementation(
    () =>
      ({
        search: { get: jest.fn<any>().mockResolvedValue({ coins: [] }) },
        simple: { price: { get: jest.fn<any>().mockResolvedValue({}) } },
        coins: { marketChart: { get: jest.fn<any>().mockResolvedValue({ prices: [] }), getRange } },
      }) as any,
  );
};

const dayKey = ({ daysAgo }: { daysAgo: number }): string => subDays(new Date(), daysAgo).toISOString().slice(0, 10);
const futureDayKey = ({ daysAhead }: { daysAhead: number }): string =>
  addDays(new Date(), daysAhead).toISOString().slice(0, 10);

const DAY_0 = dayKey({ daysAgo: 23 });
const DAY_1 = dayKey({ daysAgo: 22 });
const DAY_2 = dayKey({ daysAgo: 21 });
const DAY_3 = dayKey({ daysAgo: 20 });

const USDT = 'USDT';
const USD = 'USD';
const EUR = 'EUR';

/** The `[timestamp, price]` points of a daily series, as CoinGecko returns them (00:00 UTC). */
const seriesOf = (entries: [day: string, price: number][]) => ({
  prices: entries.map(([day, price]) => [Date.parse(`${day}T00:00:00.000Z`), price]),
});

const historyOf = async ({ code }: { code: string }) => helpers.getCurrencyRateHistory({ code, raw: true });

/**
 * Creates the currency with the rate a new custom currency needs, quoted in `quote`. A custom
 * currency keeps one manual quote, so the test's own rates use the same one. `dropCreationRate`
 * removes the creation row once the test has stored others, so the list holds only its rows.
 */
const createCurrency = async ({ code, quote = USD }: { code: string; quote?: string }) => {
  const response = await helpers.createCustomCurrency({
    payload: { code, name: code, decimals: 6, rate: { value: 1, quoteCode: quote } },
  });
  expect(response.statusCode).toBe(201);

  const [created] = (await historyOf({ code })).items;

  return {
    created: created!,
    dropCreationRate: async () => {
      const removal = await removeRate({ code, quote: created!.quoteCode, day: created!.effectiveDate });
      expect(removal.statusCode).toBe(200);
    },
  };
};

/** A manual rate of `code` in `quote`, in both directions as the editor writes it. */
const setRate = async ({ code, quote, rate, day }: { code: string; quote: string; rate: number; day: string }) => {
  const pairs = [
    { baseCode: code, quoteCode: quote, rate, effectiveDate: day },
    { baseCode: quote, quoteCode: code, rate: 1 / rate, effectiveDate: day },
  ];
  const response = await helpers.editCurrencyExchangeRate({ pairs });
  expect(response.statusCode).toBe(200);
};

const removeRate = ({ code, quote, day }: { code: string; quote: string; day: string }) =>
  helpers.removeCurrencyExchangeRate({
    pairs: [
      { baseCode: code, quoteCode: quote, effectiveDate: day },
      { baseCode: quote, quoteCode: code, effectiveDate: day },
    ],
  });

const setSource = async ({ code, payload }: { code: string; payload: Record<string, unknown> }) => {
  const response = await helpers.setCurrencyRateSource({ code, payload });
  expect(response.statusCode).toBe(200);
};

/** The rows as `quote@day`, in the order the list returns them. */
const keysOf = (items: CurrencyRateHistoryItem[]) => items.map((item) => `${item.quoteCode}@${item.effectiveDate}`);

const inForceKeys = (items: CurrencyRateHistoryItem[]) => keysOf(items.filter((item) => item.isInForce));

const errorOf = (response: { body: { response: unknown } }) => response.body.response as ErrorResponse;

describe('GET /user/currencies/:code/rate-history', () => {
  beforeEach(async () => {
    installCoingeckoMock();
    await helpers.addUserCurrencies({ currencyCodes: [USD, EUR], raw: true });
  });

  describe('listing', () => {
    it('lists the rates of the currency latest first, marks the one in force and leaves the inverse rows out', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1.01, day: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, day: DAY_2 });
      await setRate({ code: USDT, quote: USD, rate: 1.03, day: DAY_3 });
      await dropCreationRate();

      const history = await historyOf({ code: USDT });

      expect(keysOf(history.items)).toEqual([`${USD}@${DAY_3}`, `${USD}@${DAY_2}`, `${USD}@${DAY_1}`]);
      expect(history.totalCount).toBe(3);
      expect(history.items.map((item) => item.rate)).toEqual([1.03, 1.02, 1.01]);
      expect(history.items.every((item) => item.source === 'manual')).toBe(true);
      expect(history.items.every((item) => !Number.isNaN(Date.parse(item.writtenAt)))).toBe(true);
      expect(inForceKeys(history.items)).toEqual([`${USD}@${DAY_3}`]);
    });

    it('lists a rate that starts in the future but does not put it in force', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      const tomorrow = futureDayKey({ daysAhead: 1 });
      await setRate({ code: USDT, quote: USD, rate: 1.01, day: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 2, day: tomorrow });
      await dropCreationRate();

      const history = await historyOf({ code: USDT });

      expect(keysOf(history.items)).toEqual([`${USD}@${tomorrow}`, `${USD}@${DAY_1}`]);
      expect(inForceKeys(history.items)).toEqual([`${USD}@${DAY_1}`]);
    });

    it('puts the earliest rate in force when every rate starts in the future', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      const tomorrow = futureDayKey({ daysAhead: 1 });
      const later = futureDayKey({ daysAhead: 2 });
      await setRate({ code: USDT, quote: USD, rate: 2, day: tomorrow });
      await setRate({ code: USDT, quote: USD, rate: 3, day: later });
      await dropCreationRate();

      expect(inForceKeys((await historyOf({ code: USDT })).items)).toEqual([`${USD}@${tomorrow}`]);
    });

    it('marks the rows a synced source stored with that source', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      getRange.mockResolvedValue(
        seriesOf([
          [DAY_1, 1],
          [DAY_2, 1.1],
          [DAY_3, 1.2],
        ]),
      );

      await setSource({ code: USDT, payload: { rateSource: 'coingecko', config: { coinId: 'tether' } } });
      await dropCreationRate();
      const history = await historyOf({ code: USDT });

      expect(keysOf(history.items)).toEqual([`${USD}@${DAY_3}`, `${USD}@${DAY_2}`, `${USD}@${DAY_1}`]);
      expect(history.items.every((item) => item.source === 'coingecko')).toBe(true);
      expect(inForceKeys(history.items)).toEqual([`${USD}@${DAY_3}`]);
    });
  });

  describe('pagination', () => {
    it('answers the total on the first page only', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1, day: DAY_0 });
      await setRate({ code: USDT, quote: USD, rate: 1.01, day: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, day: DAY_2 });
      await setRate({ code: USDT, quote: USD, rate: 1.03, day: DAY_3 });
      await dropCreationRate();

      const first = await helpers.getCurrencyRateHistory({ code: USDT, limit: 2, raw: true });
      const rest = await helpers.getCurrencyRateHistory({ code: USDT, limit: 2, offset: 2, raw: true });

      expect(keysOf(first.items)).toEqual([`${USD}@${DAY_3}`, `${USD}@${DAY_2}`]);
      expect(first.totalCount).toBe(4);
      expect(keysOf(rest.items)).toEqual([`${USD}@${DAY_1}`, `${USD}@${DAY_0}`]);
      expect(rest.totalCount).toBeNull();
    });

    it('marks the rate in force on the page it is listed on', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1.01, day: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, day: DAY_2 });
      await dropCreationRate();

      const first = await helpers.getCurrencyRateHistory({ code: USDT, limit: 1, raw: true });
      const second = await helpers.getCurrencyRateHistory({ code: USDT, limit: 1, offset: 1, raw: true });

      expect(inForceKeys(first.items)).toEqual([`${USD}@${DAY_2}`]);
      expect(inForceKeys(second.items)).toEqual([]);
    });

    it.each([
      ['limit=0', { limit: 0 }],
      ['limit=101', { limit: 101 }],
      ['offset=-1', { offset: -1 }],
    ])('rejects %s', async (_name, query) => {
      await createCurrency({ code: USDT });

      const response = await helpers.getCurrencyRateHistory({ code: USDT, ...query });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });
  });

  describe('a new currency', () => {
    it('lists the rate it was created with, in force', async () => {
      const { created } = await createCurrency({ code: USDT });

      const history = await historyOf({ code: USDT });
      expect(history.totalCount).toBe(1);
      expect(history.items).toEqual([{ ...created, isInForce: true }]);
      expect(created).toMatchObject({ quoteCode: USD, rate: 1, source: 'manual' });
    });

    it('lists the rate it was created with out of force while a peg runs', async () => {
      await createCurrency({ code: USDT });
      await setSource({ code: USDT, payload: { rateSource: 'peg', config: { pegCurrency: USD, factor: 1 } } });

      const history = await historyOf({ code: USDT });
      expect(history.totalCount).toBe(1);
      expect(inForceKeys(history.items)).toEqual([]);
    });
  });

  describe('which rate is in force', () => {
    it('keeps the rates stored before a peg listed, and none of them in force while the peg runs', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1.01, day: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, day: DAY_2 });
      await dropCreationRate();

      await setSource({ code: USDT, payload: { rateSource: 'peg', config: { pegCurrency: USD, factor: 1 } } });
      const pegged = await historyOf({ code: USDT });

      expect(keysOf(pegged.items)).toEqual([`${USD}@${DAY_2}`, `${USD}@${DAY_1}`]);
      expect(pegged.totalCount).toBe(2);
      expect(inForceKeys(pegged.items)).toEqual([]);

      await setSource({ code: USDT, payload: { rateSource: 'manual' } });
      const manual = await historyOf({ code: USDT });

      expect(inForceKeys(manual.items)).toEqual([`${USD}@${DAY_2}`]);
    });

    it('prefers the exact pair to the base over a newer rate a synced source kept in another quote', async () => {
      const base = global.BASE_CURRENCY_CODE;
      const { dropCreationRate } = await createCurrency({ code: USDT, quote: base });
      await setRate({ code: USDT, quote: base, rate: 3.6, day: DAY_1 });
      await dropCreationRate();
      getRange.mockResolvedValue(seriesOf([[DAY_2, 0.9]]));
      await setSource({
        code: USDT,
        payload: { rateSource: 'coingecko', config: { coinId: 'tether', quoteCurrency: EUR } },
      });
      await setSource({ code: USDT, payload: { rateSource: 'manual' } });

      const history = await historyOf({ code: USDT });

      expect(keysOf(history.items)).toEqual([`${EUR}@${DAY_2}`, `${base}@${DAY_1}`]);
      expect(inForceKeys(history.items)).toEqual([`${base}@${DAY_1}`]);
    });

    it('prefers the USD row of a USD-base user over a newer EUR row, and falls back to EUR without it', async () => {
      const usdUser = await helpers.provisionSecondUserWithBaseCurrency({ currencyCode: USD });

      await helpers.asUser({
        cookies: usdUser.cookies,
        fn: async () => {
          await helpers.addUserCurrencies({ currencyCodes: [EUR], raw: true });
          const { dropCreationRate } = await createCurrency({ code: USDT });
          await setRate({ code: USDT, quote: USD, rate: 1.01, day: DAY_1 });
          await dropCreationRate();
          getRange.mockResolvedValue(seriesOf([[DAY_2, 0.9]]));
          await setSource({
            code: USDT,
            payload: { rateSource: 'coingecko', config: { coinId: 'tether', quoteCurrency: EUR } },
          });
          await setSource({ code: USDT, payload: { rateSource: 'manual' } });

          const both = await historyOf({ code: USDT });
          expect(keysOf(both.items)).toEqual([`${EUR}@${DAY_2}`, `${USD}@${DAY_1}`]);
          expect(inForceKeys(both.items)).toEqual([`${USD}@${DAY_1}`]);

          await removeRate({ code: USDT, quote: USD, day: DAY_1 });
          const onlyEur = await historyOf({ code: USDT });
          expect(keysOf(onlyEur.items)).toEqual([`${EUR}@${DAY_2}`]);
          expect(inForceKeys(onlyEur.items)).toEqual([`${EUR}@${DAY_2}`]);
        },
      });
    });
  });

  describe('errors', () => {
    it('rejects an ISO code', async () => {
      const response = await helpers.getCurrencyRateHistory({ code: USD });

      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('answers 404 for an unknown code and for the custom code of another user, with the same message', async () => {
      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: () => createCurrency({ code: 'BOBCOIN', quote: global.BASE_CURRENCY_CODE }),
      });

      const other = await helpers.getCurrencyRateHistory({ code: 'BOBCOIN' });
      const unknown = await helpers.getCurrencyRateHistory({ code: 'NOSUCH' });

      expect(other.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(unknown.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(errorOf(other).message.replace('BOBCOIN', '<code>')).toBe(
        errorOf(unknown).message.replace('NOSUCH', '<code>'),
      );
    });

    it("never lists another user's rates for the same code", async () => {
      const mine = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1.01, day: DAY_1 });
      await mine.dropCreationRate();

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await helpers.addUserCurrencies({ currencyCodes: [USD], raw: true });
          const theirs = await createCurrency({ code: USDT });
          await setRate({ code: USDT, quote: USD, rate: 5, day: DAY_2 });
          await theirs.dropCreationRate();

          expect(keysOf((await historyOf({ code: USDT })).items)).toEqual([`${USD}@${DAY_2}`]);
        },
      });

      expect(keysOf((await historyOf({ code: USDT })).items)).toEqual([`${USD}@${DAY_1}`]);
    });
  });

  describe('editing and removing a listed row', () => {
    it('changes only the row that names its effective date', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1.01, day: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, day: DAY_2 });
      await dropCreationRate();

      await setRate({ code: USDT, quote: USD, rate: 1.5, day: DAY_1 });
      const edited = await historyOf({ code: USDT });
      expect(edited.items.map((item) => [item.effectiveDate, item.rate])).toEqual([
        [DAY_2, 1.02],
        [DAY_1, 1.5],
      ]);

      const removal = await removeRate({ code: USDT, quote: USD, day: DAY_1 });
      expect(removal.statusCode).toBe(200);
      const removed = await historyOf({ code: USDT });
      expect(keysOf(removed.items)).toEqual([`${USD}@${DAY_2}`]);
      expect(removed.totalCount).toBe(1);
    });

    it('lists the rows a synced source kept in a quote the user does not hold, which can be removed but not edited', async () => {
      const usdUser = await helpers.provisionSecondUserWithBaseCurrency({ currencyCode: USD });

      await helpers.asUser({
        cookies: usdUser.cookies,
        fn: async () => {
          const { dropCreationRate } = await createCurrency({ code: USDT });
          getRange.mockResolvedValue(
            seriesOf([
              [DAY_1, 0.9],
              [DAY_2, 0.95],
            ]),
          );
          await setSource({
            code: USDT,
            payload: { rateSource: 'coingecko', config: { coinId: 'tether', quoteCurrency: EUR } },
          });
          await setSource({ code: USDT, payload: { rateSource: 'manual' } });
          await dropCreationRate();

          const kept = await historyOf({ code: USDT });
          expect(keysOf(kept.items)).toEqual([`${EUR}@${DAY_2}`, `${EUR}@${DAY_1}`]);
          expect(kept.items.every((item) => item.source === 'coingecko')).toBe(true);
          expect(inForceKeys(kept.items)).toEqual([`${EUR}@${DAY_2}`]);

          // A custom rate is quoted only in an ISO currency the user holds, and they do not hold EUR.
          const edit = await helpers.editCurrencyExchangeRate({
            pairs: [
              { baseCode: USDT, quoteCode: EUR, rate: 2, effectiveDate: DAY_2 },
              { baseCode: EUR, quoteCode: USDT, rate: 0.5, effectiveDate: DAY_2 },
            ],
          });
          expect(edit.statusCode).toBe(ERROR_CODES.ValidationError);
          expect((await historyOf({ code: USDT })).items.map((item) => item.rate)).toEqual([0.95, 0.9]);

          const removal = await removeRate({ code: USDT, quote: EUR, day: DAY_2 });
          expect(removal.statusCode).toBe(200);
          expect(keysOf((await historyOf({ code: USDT })).items)).toEqual([`${EUR}@${DAY_1}`]);
        },
      });
    });
  });
});
