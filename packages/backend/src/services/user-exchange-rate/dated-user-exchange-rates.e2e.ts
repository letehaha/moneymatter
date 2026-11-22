import { TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';

const BASE = (): string => global.BASE_CURRENCY_CODE;
const NEW_BASE = 'EUR';
const QUOTE = 'USD';
/** What the market says one dollar is worth in the test user's base (AED) on the seeded days. */
const MARKET_AED_PER_USD = 4;

const { createAccountInCurrency: createAccountIn, dayKey, rateValueOn, readTx, storedRates } = helpers;
const dayDate = ({ day }: { day: string }): Date => new Date(`${day}T00:00:00.000Z`);

// Distinct, recent days that no other suite seeds. Not 10 days ago: the seed migration puts the
// market rates every suite falls back on there, and clearing a seeded day deletes them.
const DAY_1 = dayKey({ daysAgo: 9 });
const DAY_2 = dayKey({ daysAgo: 8 });
const DAY_3 = dayKey({ daysAgo: 7 });
const DAY_BEFORE = dayKey({ daysAgo: 11 });
const SEEDED_DAYS = [DAY_BEFORE, DAY_1, DAY_2, DAY_3];
const TODAY = (): string => dayKey({ daysAgo: 0 });

type RateParams = Parameters<typeof helpers.userRatePairs>[0];

/** The user's own rate for `code` in `quote`, dollars unless given. */
const pairRates = ({ quote = QUOTE, ...rate }: RateParams) => helpers.userRatePairs({ quote, ...rate });
const setRate = ({ quote = QUOTE, ...rate }: RateParams) => helpers.setUserRate({ quote, ...rate });

/** A custom currency's first rate starts today, quoted in `quote` (dollars unless given). */
const createCurrency = ({ quote = QUOTE, ...rest }: Parameters<typeof helpers.addCustomCurrency>[0]) =>
  helpers.addCustomCurrency({ quote, ...rest });

const createTx = async (params: { accountId: string; amount: number; day: string }) =>
  (await helpers.createTxOn({ ...params, type: TRANSACTION_TYPES.income }))[0]!;

const seedMarket = async ({ day, eurPerUsd }: { day: string; eurPerUsd: number }) =>
  helpers.seedUsdExchangeRates({
    date: dayDate({ day }),
    ratesPerUsd: { AED: MARKET_AED_PER_USD, EUR: eurPerUsd },
  });

const restoreArchive = async ({ base64 }: { base64: string }) => {
  const restore = await helpers.restoreBackup({ fileContent: base64 });
  expect({ statusCode: restore.statusCode, message: restore.message }).toEqual({ statusCode: 200, message: null });
  const status = await helpers.waitForRestore({ jobId: restore.jobId! });
  expect({ status: status.status, error: status.error }).toEqual({ status: 'completed', error: undefined });
};

/** Stored rows of an ISO pair or an inverse direction, which the rate-history endpoint never lists. */
const storedRows = async (where: { baseCode?: string; quoteCode?: string }) => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });

  return UserExchangeRates.findAll({ where: { userId, ...where }, raw: true });
};

const keysOf = async ({ code }: { code: string }) =>
  (await storedRates({ code })).map((row) => `${row.quote}@${row.day}`).toSorted();

describe('Dated user exchange rates', () => {
  beforeEach(async () => {
    await helpers.addUserCurrencies({ currencyCodes: [QUOTE, NEW_BASE], raw: true });
    for (const day of [DAY_BEFORE, DAY_1, DAY_2, DAY_3]) await seedMarket({ day, eurPerUsd: 0.5 });

    const user = (await helpers.makeRequest({ method: 'get', url: '/user', raw: true })) as { id: number };
    await RateLimitService.resetRateLimit(`backup:user:${user.id}`);
    await RateLimitService.resetRateLimit(`backup-restore:user:${user.id}`);
  });

  afterEach(async () => {
    await helpers.clearExchangeRatesForDates({ dates: SEEDED_DAYS.map((day) => dayDate({ day })) });
  });

  describe('ISO currencies', () => {
    it('applies a manual rate set today to a transaction back-dated before it', async () => {
      await setRate({ code: QUOTE, rate: 5, quote: BASE() });
      const usd = await createAccountIn({ code: QUOTE });

      const created = await createTx({ accountId: usd.id, amount: 10, day: DAY_1 });

      // The market says 4 AED per dollar on that day; the manual rate applies to every date.
      expect(created.refAmount).toBe(50);
      expect(await rateValueOn({ from: QUOTE, to: BASE(), day: DAY_BEFORE })).toBe(5);
    });

    it('stores the day the rate was entered and refuses an effective date of its own', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { rates } = await setRate({ code: QUOTE, rate: 5, quote: BASE() });

      expect(rates.map((row) => ({ effectiveDate: row.effectiveDate, source: row.source }))).toEqual([
        { effectiveDate: today, source: 'manual' },
        { effectiveDate: today, source: 'manual' },
      ]);

      const refused = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: QUOTE, rate: 6, quote: BASE(), effectiveDate: DAY_1 }),
      });
      expect(refused.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await rateValueOn({ from: QUOTE, to: BASE(), day: DAY_1 })).toBe(5);
    });

    it('keeps a single rate for the pair when it is edited again', async () => {
      await setRate({ code: QUOTE, rate: 5, quote: BASE() });
      await setRate({ code: QUOTE, rate: 6, quote: BASE() });

      const rows = await storedRows({ baseCode: QUOTE });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rate).toBe(6);
    });

    it('removes the rate of a pair without a day, which goes back to the market rate', async () => {
      await setRate({ code: QUOTE, rate: 5, quote: BASE() });

      await helpers.removeUserRate({ code: QUOTE });

      expect(await storedRows({ baseCode: QUOTE })).toEqual([]);
      expect(await rateValueOn({ from: QUOTE, to: BASE(), day: DAY_1 })).toBe(MARKET_AED_PER_USD);
    });

    it.each([
      ['a past day', DAY_1],
      ['the day it was entered', TODAY()],
    ])('refuses to remove the rate of a pair on %s and keeps it in force', async (_label, effectiveDate) => {
      await setRate({ code: NEW_BASE, rate: 5, quote: BASE() });

      const refused = await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: NEW_BASE, quoteCode: BASE(), effectiveDate },
          { baseCode: BASE(), quoteCode: NEW_BASE, effectiveDate },
        ],
      });

      expect(refused.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await storedRows({ baseCode: NEW_BASE })).toHaveLength(1);
      // The market says 8 AED per euro on that day.
      expect(await rateValueOn({ from: NEW_BASE, to: BASE(), day: DAY_1 })).toBe(5);
    });
  });

  describe('custom currencies', () => {
    it('values the rows before the first rate again when an earlier rate is added', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      await setRate({ code: 'USDT', rate: 1.5, effectiveDate: DAY_2 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const early = await createTx({ accountId: usdt.id, amount: 10, day: DAY_BEFORE });
      expect(early.refAmount).toBe(10 * 1.5 * MARKET_AED_PER_USD);

      await setRate({ code: 'USDT', rate: 2, effectiveDate: DAY_1 });

      expect((await readTx({ id: early.id })).refAmount).toBe(10 * 2 * MARKET_AED_PER_USD);
    }, 60000);

    it('edits only the day it is given and leaves the other days alone', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });
      await setRate({ code: 'USDT', rate: 2, effectiveDate: DAY_3 });

      const { rates } = await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_3 });

      expect(rates.map((row) => row.effectiveDate)).toEqual([DAY_3]);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_1 })).toBe(1);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_2 })).toBe(1);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_3 })).toBe(3);
      // DAY_1, DAY_3 and the first rate, which starts today.
      expect(await storedRates({ code: 'USDT' })).toHaveLength(3);
    });

    it('refuses to remove the last rate of a custom currency', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      const removeBothWays = (effectiveDate?: string) =>
        helpers.removeCurrencyExchangeRate({
          pairs: [
            { baseCode: 'USDT', quoteCode: QUOTE, effectiveDate },
            { baseCode: QUOTE, quoteCode: 'USDT', effectiveDate },
          ],
          raw: false,
        });

      expect((await removeBothWays(TODAY())).statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await removeBothWays()).statusCode).toBe(ERROR_CODES.ValidationError);

      expect(await storedRates({ code: 'USDT' })).toHaveLength(1);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_1 })).toBe(5);
    });

    it('starts a rate entered without a day today and leaves the days of earlier rates alone', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });

      const { rates } = await setRate({ code: 'USDT', rate: 1 });

      expect(rates.map((row) => row.effectiveDate)).toEqual([TODAY()]);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_2 })).toBe(3);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: TODAY() })).toBe(1);
    });

    it('keeps every other day when a rate is entered in another quote, and replaces only its own day', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });
      await setRate({ code: 'USDT', rate: 2, effectiveDate: DAY_3 });

      await setRate({ code: 'USDT', rate: 3, quote: NEW_BASE, effectiveDate: DAY_2 });
      await setRate({ code: 'USDT', rate: 1.5, quote: NEW_BASE, effectiveDate: DAY_3 });

      expect(await keysOf({ code: 'USDT' })).toEqual(
        [`${QUOTE}@${DAY_1}`, `${NEW_BASE}@${DAY_2}`, `${NEW_BASE}@${DAY_3}`, `${QUOTE}@${TODAY()}`].toSorted(),
      );
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_1 })).toBe(1);
      expect(await rateValueOn({ from: 'USDT', to: NEW_BASE, day: DAY_2 })).toBe(3);
      expect(await rateValueOn({ from: 'USDT', to: NEW_BASE, day: DAY_3 })).toBe(1.5);
    });

    it('stores only the custom-to-ISO rate and prices the other direction as its inverse', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      const edit = await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USDT', quoteCode: QUOTE, rate: 4, effectiveDate: DAY_1 },
          { baseCode: QUOTE, quoteCode: 'USDT', rate: 0.3, effectiveDate: DAY_1 },
        ],
      });
      expect(edit.statusCode).toBe(200);

      expect(await rateValueOn({ from: QUOTE, to: 'USDT', day: DAY_1 })).toBe(0.25);
      expect(await storedRows({ quoteCode: 'USDT' })).toEqual([]);
    });

    it('refuses to remove every rate of a custom pair at once, and keeps them', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });

      const removal = await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USDT', quoteCode: QUOTE },
          { baseCode: QUOTE, quoteCode: 'USDT' },
        ],
        raw: false,
      });

      expect(removal.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(await storedRates({ code: 'USDT' })).toHaveLength(2);
    });

    it('refuses a manual rate and a removal while a peg prices the currency, and keeps its rates', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });
      const pegged = await helpers.setCurrencyRateSource({
        code: 'USDT',
        payload: { rateSource: 'peg', config: { pegCurrency: QUOTE, factor: 1 } },
      });
      expect(pegged.statusCode).toBe(200);
      const before = await storedRates({ code: 'USDT' });

      const edit = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: 'USDT', rate: 2, effectiveDate: DAY_2 }),
      });
      const removal = await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USDT', quoteCode: QUOTE, effectiveDate: DAY_1 },
          { baseCode: QUOTE, quoteCode: 'USDT', effectiveDate: DAY_1 },
        ],
        raw: false,
      });

      expect([edit.statusCode, removal.statusCode]).toEqual([ERROR_CODES.ValidationError, ERROR_CODES.ValidationError]);
      expect(await storedRates({ code: 'USDT' })).toEqual(before);
    });

    it('refuses a calendar day that does not exist', async () => {
      await createCurrency({ code: 'USDT' });

      const refused = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: 'USDT', rate: 1, effectiveDate: '2026-02-30' }),
      });

      expect(refused.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('keeps the full precision of a rate so a million units of a tiny coin convert to exactly one', async () => {
      await createCurrency({ code: 'SAT', decimals: 8, rate: 0.000002, quote: BASE() });
      await setRate({ code: 'SAT', rate: 0.000001, quote: BASE(), effectiveDate: DAY_1 });
      const sat = await createAccountIn({ code: 'SAT' });

      const created = await createTx({ accountId: sat.id, amount: 1_000_000, day: DAY_2 });

      expect(await rateValueOn({ from: 'SAT', to: BASE(), day: DAY_2 })).toBe(0.000001);
      expect(created.refAmount).toBe(1);
    });
  });

  describe('a rate quoted in another custom currency', () => {
    it('is refused, and the currency keeps its own rate', async () => {
      await createCurrency({ code: 'SAT', decimals: 8, rate: 2 });
      await createCurrency({ code: 'COIN', decimals: 8, rate: 10 });

      const refused = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: 'SAT', quote: 'COIN', rate: 2, effectiveDate: DAY_1 }),
      });

      expect(refused.statusCode).toBe(ERROR_CODES.ValidationError);
      expect((await storedRates({ code: 'SAT' })).filter((row) => row.quote === 'COIN')).toEqual([]);
      expect(await rateValueOn({ from: 'SAT', to: QUOTE, day: DAY_2 })).toBe(2);
    }, 30000);
  });

  describe('changing the base currency', () => {
    it('keeps the dated rates in the old base when a rate is entered in the new one', async () => {
      const oldBase = BASE();
      await createCurrency({ code: 'USDT', rate: 1, quote: oldBase });
      await setRate({ code: 'USDT', rate: 3, quote: oldBase, effectiveDate: DAY_1 });
      await setRate({ code: 'USDT', rate: 4, quote: oldBase, effectiveDate: DAY_2 });
      helpers.expectBaseCurrencyChangeCompleted(await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE }));

      await setRate({ code: 'USDT', rate: 2, quote: NEW_BASE, effectiveDate: DAY_3 });

      expect(await keysOf({ code: 'USDT' })).toEqual(
        [`${oldBase}@${DAY_1}`, `${oldBase}@${DAY_2}`, `${NEW_BASE}@${DAY_3}`, `${oldBase}@${TODAY()}`].toSorted(),
      );
      expect(await rateValueOn({ from: 'USDT', to: oldBase, day: DAY_1 })).toBe(3);
      expect(await rateValueOn({ from: 'USDT', to: oldBase, day: DAY_2 })).toBe(4);
      expect(await rateValueOn({ from: 'USDT', to: NEW_BASE, day: DAY_3 })).toBe(2);
    }, 90000);

    it('converts every day of a backfilled history with that day', async () => {
      await createCurrency({ code: 'USDT', rate: 3 });
      await seedMarket({ day: DAY_1, eurPerUsd: 0.5 });
      await seedMarket({ day: DAY_2, eurPerUsd: 0.5 });
      await seedMarket({ day: DAY_3, eurPerUsd: 0.25 });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });
      await setRate({ code: 'USDT', rate: 2, effectiveDate: DAY_2 });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_3 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const txs = [
        await createTx({ accountId: usdt.id, amount: 10, day: DAY_1 }),
        await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 }),
        await createTx({ accountId: usdt.id, amount: 10, day: DAY_3 }),
      ];
      expect(txs.map((row) => row.refAmount)).toEqual([40, 80, 120]);

      helpers.expectBaseCurrencyChangeCompleted(await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE }));

      const rebuilt = await Promise.all(txs.map((row) => readTx({ id: row.id })));
      // amount x USDT rate of the day x EUR per USD of the day
      expect(rebuilt.map((row) => row.refAmount)).toEqual([10 * 1 * 0.5, 10 * 2 * 0.5, 10 * 3 * 0.25]);
      expect((await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 })).refAmount).toBe(10 * 2 * 0.5);
    }, 90000);
  });

  describe('backup', () => {
    it('restores every dated rate of a custom currency', async () => {
      await createCurrency({ code: 'USDT', rate: 5 });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });
      await setRate({ code: 'USDT', rate: 2, effectiveDate: DAY_3 });

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const exportedRates = archive.readData({ name: 'user-exchange-rates' }) as { effectiveDate: string }[];
      expect(exportedRates.map((row) => row.effectiveDate).toSorted()).toEqual([DAY_1, DAY_3, TODAY()]);

      await restoreArchive({ base64: exported.body.toString('base64') });

      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_2 })).toBe(1);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_3 })).toBe(2);
      expect(await storedRates({ code: 'USDT' })).toHaveLength(3);
    }, 90000);
  });
});
