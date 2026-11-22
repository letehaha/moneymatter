import type { CurrencyRateHistoryItem } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';

const { coingeckoHistory: seriesOf, dayKey, rateValueOn, removeUserRate: removeRate, setUserRate: setRate } = helpers;
const { getRange } = helpers.coingeckoMock;

const DAY_0 = dayKey({ daysAgo: 23 });
const DAY_1 = dayKey({ daysAgo: 22 });
const DAY_2 = dayKey({ daysAgo: 21 });
const DAY_3 = dayKey({ daysAgo: 20 });

const USDT = 'USDT';
const USD = 'USD';
const EUR = 'EUR';

const historyOf = async ({ code }: { code: string }) => helpers.getCurrencyRateHistory({ code, raw: true });

/**
 * Creates the currency with the rate a new custom currency needs, quoted in `quote`. `dropCreationRate`
 * removes the creation row once the test has stored others, so the list holds only its rows.
 */
const createCurrency = async ({ code, quote = USD }: { code: string; quote?: string }) => {
  await helpers.addCustomCurrency({ code, quote });
  const [created] = (await historyOf({ code })).items;

  return {
    created: created!,
    dropCreationRate: () => removeRate({ code, quote: created!.quoteCode, effectiveDate: created!.effectiveDate }),
  };
};

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
    helpers.resetCoingeckoMock();
    await helpers.addUserCurrencies({ currencyCodes: [USD, EUR], raw: true });
  });

  describe('listing', () => {
    it('lists the rates of the currency latest first, marks the one in force and leaves the inverse rows out', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1.01, effectiveDate: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, effectiveDate: DAY_2 });
      await setRate({ code: USDT, quote: USD, rate: 1.03, effectiveDate: DAY_3 });
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
      const tomorrow = dayKey({ daysAgo: -1 });
      await setRate({ code: USDT, quote: USD, rate: 1.01, effectiveDate: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 2, effectiveDate: tomorrow });
      await dropCreationRate();

      const history = await historyOf({ code: USDT });

      expect(keysOf(history.items)).toEqual([`${USD}@${tomorrow}`, `${USD}@${DAY_1}`]);
      expect(inForceKeys(history.items)).toEqual([`${USD}@${DAY_1}`]);
    });

    it('puts the earliest rate in force when every rate starts in the future', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      const tomorrow = dayKey({ daysAgo: -1 });
      const later = dayKey({ daysAgo: -2 });
      await setRate({ code: USDT, quote: USD, rate: 2, effectiveDate: tomorrow });
      await setRate({ code: USDT, quote: USD, rate: 3, effectiveDate: later });
      await dropCreationRate();

      expect(inForceKeys((await historyOf({ code: USDT })).items)).toEqual([`${USD}@${tomorrow}`]);
    });

    it('marks the rows a synced source stored with that source, next to the creation rate', async () => {
      const { created } = await createCurrency({ code: USDT });
      getRange.mockResolvedValue(
        seriesOf([
          [DAY_1, 1],
          [DAY_2, 1.1],
          [DAY_3, 1.2],
        ]),
      );

      await setSource({ code: USDT, payload: { rateSource: 'coingecko', config: { coinId: 'tether' } } });
      const history = await historyOf({ code: USDT });

      expect(keysOf(history.items)).toEqual([
        `${USD}@${created.effectiveDate}`,
        `${USD}@${DAY_3}`,
        `${USD}@${DAY_2}`,
        `${USD}@${DAY_1}`,
      ]);
      expect(history.items.map((item) => item.source)).toEqual(['initial', 'coingecko', 'coingecko', 'coingecko']);
      expect(inForceKeys(history.items)).toEqual([`${USD}@${created.effectiveDate}`]);
    });
  });

  describe('pagination', () => {
    it('answers the total on the first page only', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1, effectiveDate: DAY_0 });
      await setRate({ code: USDT, quote: USD, rate: 1.01, effectiveDate: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, effectiveDate: DAY_2 });
      await setRate({ code: USDT, quote: USD, rate: 1.03, effectiveDate: DAY_3 });
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
      await setRate({ code: USDT, quote: USD, rate: 1.01, effectiveDate: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, effectiveDate: DAY_2 });
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
      expect(created).toMatchObject({ quoteCode: USD, rate: 1, source: 'initial' });
    });

    it('turns the rate it was created with into a manual one when that day is edited', async () => {
      const { created } = await createCurrency({ code: USDT });

      await setRate({ code: USDT, quote: USD, rate: 1.5, effectiveDate: created.effectiveDate });

      expect((await historyOf({ code: USDT })).items).toMatchObject([
        { quoteCode: USD, effectiveDate: created.effectiveDate, rate: 1.5, source: 'manual', isInForce: true },
      ]);
    });
  });

  describe('which rate is in force', () => {
    it('keeps the rates stored before a peg listed, and none of them in force while the peg runs', async () => {
      const { dropCreationRate } = await createCurrency({ code: USDT });
      await setRate({ code: USDT, quote: USD, rate: 1.01, effectiveDate: DAY_1 });
      await setRate({ code: USDT, quote: USD, rate: 1.02, effectiveDate: DAY_2 });
      await dropCreationRate();

      await setSource({ code: USDT, payload: { rateSource: 'peg', config: { pegCurrency: USD, factor: 1 } } });
      const pegged = await historyOf({ code: USDT });

      expect(keysOf(pegged.items)).toEqual([`${USD}@${DAY_2}`, `${USD}@${DAY_1}`]);
      expect(pegged.totalCount).toBe(2);
      expect(inForceKeys(pegged.items)).toEqual([]);

      await setSource({ code: USDT, payload: { rateSource: 'manual' } });
      const manual = await historyOf({ code: USDT });

      expect(inForceKeys(manual.items)).toEqual([`${USD}@${DAY_2}`]);
      expect(await rateValueOn({ from: USDT, to: USD, day: DAY_1 })).toBe(1.01);
    });

    it('keeps the rate stored for each day, in any quote, after switching back to manual', async () => {
      const base = global.BASE_CURRENCY_CODE;
      const { dropCreationRate } = await createCurrency({ code: USDT, quote: base });
      await setRate({ code: USDT, quote: base, rate: 3.6, effectiveDate: DAY_1 });
      await dropCreationRate();
      getRange.mockResolvedValue(seriesOf([[DAY_2, 0.9]]));
      await setSource({
        code: USDT,
        payload: { rateSource: 'coingecko', config: { coinId: 'tether', quoteCurrency: EUR } },
      });
      await setSource({ code: USDT, payload: { rateSource: 'manual' } });

      const history = await historyOf({ code: USDT });

      expect(keysOf(history.items)).toEqual([`${EUR}@${DAY_2}`, `${base}@${DAY_1}`]);
      expect(inForceKeys(history.items)).toEqual([`${EUR}@${DAY_2}`]);
      expect(await rateValueOn({ from: USDT, to: base, day: DAY_1 })).toBe(3.6);
      expect(await rateValueOn({ from: USDT, to: EUR, day: DAY_2 })).toBe(0.9);
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
      await setRate({ code: USDT, quote: USD, rate: 1.01, effectiveDate: DAY_1 });
      await mine.dropCreationRate();

      const bob = await helpers.provisionSecondUserWithBaseCurrency();
      await helpers.asUser({
        cookies: bob.cookies,
        fn: async () => {
          await helpers.addUserCurrencies({ currencyCodes: [USD], raw: true });
          const theirs = await createCurrency({ code: USDT });
          await setRate({ code: USDT, quote: USD, rate: 5, effectiveDate: DAY_2 });
          await theirs.dropCreationRate();

          expect(keysOf((await historyOf({ code: USDT })).items)).toEqual([`${USD}@${DAY_2}`]);
        },
      });

      expect(keysOf((await historyOf({ code: USDT })).items)).toEqual([`${USD}@${DAY_1}`]);
    });
  });

  describe('editing and removing a listed row', () => {
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

          await removeRate({ code: USDT, quote: EUR, effectiveDate: DAY_2 });
          expect(keysOf((await historyOf({ code: USDT })).items)).toEqual([`${EUR}@${DAY_1}`]);
        },
      });
    });
  });
});
