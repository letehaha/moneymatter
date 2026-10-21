import { type AccountApiResponse, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import { RateLimitService } from '@services/common/rate-limit.service';
import * as helpers from '@tests/helpers';
import { subDays } from 'date-fns';

const BASE = (): string => global.BASE_CURRENCY_CODE;
const NEW_BASE = 'EUR';
const QUOTE = 'USD';
/** What the market says one dollar is worth in the test user's base (AED) on the seeded days. */
const MARKET_AED_PER_USD = 4;

const dayKey = ({ daysAgo }: { daysAgo: number }): string => subDays(new Date(), daysAgo).toISOString().slice(0, 10);
const dayDate = ({ day }: { day: string }): Date => new Date(`${day}T00:00:00.000Z`);
const noonOf = ({ day }: { day: string }): string => `${day}T12:00:00.000Z`;

// Distinct, recent days that no other suite seeds.
const DAY_1 = dayKey({ daysAgo: 9 });
const DAY_2 = dayKey({ daysAgo: 8 });
const DAY_3 = dayKey({ daysAgo: 7 });
const DAY_BEFORE = dayKey({ daysAgo: 10 });
const SEEDED_DAYS = [DAY_BEFORE, DAY_1, DAY_2, DAY_3];

type RatePair = { baseCode: string; quoteCode: string; rate: number; effectiveDate?: string };

/** The user's own rate for `code` in `quote`, in both directions, as the endpoint requires. */
const pairRates = ({
  code,
  rate,
  quote = QUOTE,
  effectiveDate,
}: {
  code: string;
  rate: number;
  quote?: string;
  effectiveDate?: string;
}): RatePair[] => [
  { baseCode: code, quoteCode: quote, rate, effectiveDate },
  { baseCode: quote, quoteCode: code, rate: 1 / rate, effectiveDate },
];

const setRates = (pairs: RatePair[]) => helpers.editCurrencyExchangeRate({ pairs, raw: true });

const createCurrency = async ({ code, decimals = 6 }: { code: string; decimals?: number }) => {
  const response = await helpers.createCustomCurrency({ payload: { code, name: code, decimals } });
  expect(response.statusCode).toBe(201);
};

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
      transactionType: TRANSACTION_TYPES.income,
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

const rateOn = async ({ from, to, day }: { from: string; to: string; day: string }) =>
  helpers.getExchangeRatePair({ from, to, date: day, raw: false });

const rateValueOn = async ({ from, to, day }: { from: string; to: string; day: string }) => {
  const response = await rateOn({ from, to, day });
  expect(response.statusCode).toBe(200);

  return (response.body.response as { rate: number }).rate;
};

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

const snapshotUserRates = async () => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });
  const rows = await UserExchangeRates.findAll({ where: { userId }, raw: true });

  return rows.toSorted((a, b) =>
    `${a.baseCode}${a.quoteCode}${a.effectiveDate}`.localeCompare(`${b.baseCode}${b.quoteCode}${b.effectiveDate}`),
  );
};

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
      await setRates(pairRates({ code: QUOTE, rate: 5, quote: BASE() }));
      const usd = await createAccountIn({ code: QUOTE });

      const created = await createTx({ accountId: usd.id, amount: 10, day: DAY_1 });

      // The market says 4 AED per dollar on that day; the manual rate applies to every date.
      expect(created.refAmount).toBe(50);
      expect(await rateValueOn({ from: QUOTE, to: BASE(), day: DAY_BEFORE })).toBe(5);
    });

    it('stores the day the rate was entered and refuses an effective date of its own', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { rates } = await setRates(pairRates({ code: QUOTE, rate: 5, quote: BASE() }));

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
      await setRates(pairRates({ code: QUOTE, rate: 5, quote: BASE() }));
      await setRates(pairRates({ code: QUOTE, rate: 6, quote: BASE() }));

      const rows = (await snapshotUserRates()).filter((row) => row.baseCode === QUOTE);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.rate).toBe(6);
    });
  });

  describe('custom currencies', () => {
    it('values a back-dated transaction with the rate effective on its date', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1, effectiveDate: DAY_1 }));
      await setRates(pairRates({ code: 'USDT', rate: 2, effectiveDate: DAY_3 }));
      const usdt = await createAccountIn({ code: 'USDT' });

      const first = await createTx({ accountId: usdt.id, amount: 10, day: DAY_1 });
      const between = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      const later = await createTx({ accountId: usdt.id, amount: 10, day: DAY_3 });

      expect(first.refAmount).toBe(10 * 1 * MARKET_AED_PER_USD);
      expect(between.refAmount).toBe(10 * 1 * MARKET_AED_PER_USD);
      expect(later.refAmount).toBe(10 * 2 * MARKET_AED_PER_USD);
      expect([first, between, later].map((row) => row.refAmountMissing)).toEqual([false, false, false]);
    }, 60000);

    it('leaves a transaction dated before the first rate without a base-currency amount', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1, effectiveDate: DAY_1 }));
      const usdt = await createAccountIn({ code: 'USDT' });

      const early = await createTx({ accountId: usdt.id, amount: 10, day: DAY_BEFORE });

      expect(early.refAmount).toBeNull();
      expect(early.refAmountMissing).toBe(true);
      expect((await readTx({ id: early.id })).refAmountMissing).toBe(true);
    });

    it('edits only the day it is given and leaves the other days alone', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1, effectiveDate: DAY_1 }));
      await setRates(pairRates({ code: 'USDT', rate: 2, effectiveDate: DAY_3 }));

      const { rates } = await setRates(pairRates({ code: 'USDT', rate: 3, effectiveDate: DAY_3 }));

      expect(rates.map((row) => row.effectiveDate)).toEqual([DAY_3, DAY_3]);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_1 })).toBe(1);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_2 })).toBe(1);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_3 })).toBe(3);
      expect((await snapshotUserRates()).filter((row) => row.baseCode === 'USDT')).toHaveLength(2);
    });

    it('removes only the rate of the day it is given', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1, effectiveDate: DAY_1 }));
      await setRates(pairRates({ code: 'USDT', rate: 2, effectiveDate: DAY_3 }));

      const removed = await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USDT', quoteCode: QUOTE, effectiveDate: DAY_3 },
          { baseCode: QUOTE, quoteCode: 'USDT', effectiveDate: DAY_3 },
        ],
        raw: false,
      });
      expect(removed.statusCode).toBe(200);

      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_3 })).toBe(1);
      expect((await snapshotUserRates()).filter((row) => row.baseCode === 'USDT')).toHaveLength(1);
    });

    it('starts a rate entered without a day today, so it does not reach back before it', async () => {
      await createCurrency({ code: 'USDT' });
      const today = new Date().toISOString().slice(0, 10);

      const { rates } = await setRates(pairRates({ code: 'USDT', rate: 1 }));

      expect(rates.map((row) => row.effectiveDate)).toEqual([today, today]);
      expect((await rateOn({ from: 'USDT', to: QUOTE, day: DAY_1 })).statusCode).toBe(404);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: today })).toBe(1);
    });

    it('refuses a calendar day that does not exist', async () => {
      await createCurrency({ code: 'USDT' });

      const refused = await helpers.editCurrencyExchangeRate({
        pairs: pairRates({ code: 'USDT', rate: 1, effectiveDate: '2026-02-30' }),
      });

      expect(refused.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('keeps the full precision of a rate so a million units of a tiny coin convert to exactly one', async () => {
      await createCurrency({ code: 'SAT', decimals: 8 });
      await setRates(pairRates({ code: 'SAT', rate: 0.000001, quote: BASE(), effectiveDate: DAY_1 }));
      const sat = await createAccountIn({ code: 'SAT' });

      const created = await createTx({ accountId: sat.id, amount: 1_000_000, day: DAY_2 });

      expect(await rateValueOn({ from: 'SAT', to: BASE(), day: DAY_2 })).toBe(0.000001);
      expect(created.refAmount).toBe(1);
    });
  });

  describe('rates that quote another custom currency', () => {
    it('answers unavailable instead of looping when the rates lead back to where they started', async () => {
      await createCurrency({ code: 'SAT', decimals: 8 });
      await createCurrency({ code: 'COIN', decimals: 8 });
      // The editor stores both directions: SAT>COIN and COIN>SAT, and nothing leads out of the pair.
      await setRates(pairRates({ code: 'SAT', quote: 'COIN', rate: 2, effectiveDate: DAY_1 }));
      const sat = await createAccountIn({ code: 'SAT' });

      expect((await rateOn({ from: 'SAT', to: NEW_BASE, day: DAY_2 })).statusCode).toBe(404);

      const created = await createTx({ accountId: sat.id, amount: 5, day: DAY_2 });
      expect(created.refAmount).toBeNull();
      expect(created.refAmountMissing).toBe(true);
    }, 30000);

    it('walks past the reverse rate to the quote that leads to an ISO currency', async () => {
      await createCurrency({ code: 'SAT', decimals: 8 });
      await createCurrency({ code: 'COIN', decimals: 8 });
      await setRates(pairRates({ code: 'COIN', rate: 10, effectiveDate: DAY_1 }));
      // Written last, so COIN>SAT is the most recent rate quoted from COIN.
      await setRates(pairRates({ code: 'SAT', quote: 'COIN', rate: 2, effectiveDate: DAY_1 }));
      const sat = await createAccountIn({ code: 'SAT' });

      // 1 SAT = 2 COIN = 20 USD, and a dollar is worth 4 AED on that day.
      const created = await createTx({ accountId: sat.id, amount: 5, day: DAY_2 });

      expect(created.refAmount).toBe(5 * 2 * 10 * MARKET_AED_PER_USD);
      expect(created.refAmountMissing).toBe(false);
      expect(await rateValueOn({ from: 'SAT', to: NEW_BASE, day: DAY_2 })).toBeCloseTo(2 * 10 * 0.5, 12);
    }, 30000);
  });

  describe('changing the base currency', () => {
    it('values a custom holding on each day with its own rate, then the market rate of that day', async () => {
      await createCurrency({ code: 'USDT' });
      await seedMarket({ day: DAY_1, eurPerUsd: 0.8 });
      await seedMarket({ day: DAY_2, eurPerUsd: 0.9 });
      // USDT is worth one dollar from the first day on and has no later row.
      await setRates(pairRates({ code: 'USDT', rate: 1, effectiveDate: DAY_1 }));
      const usdt = await createAccountIn({ code: 'USDT' });
      const tx = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      expect(tx.refAmount).toBe(40);
      const ratesBefore = await snapshotUserRates();

      helpers.expectBaseCurrencyChangeCompleted(await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE }));

      const rebuilt = await readTx({ id: tx.id });
      expect(rebuilt.refCurrencyCode).toBe(NEW_BASE);
      expect(rebuilt.refAmount).toBe(9);

      const entered = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      expect(entered.refAmount).toBe(9);
      expect(await snapshotUserRates()).toEqual(ratesBefore);
    }, 90000);

    it('converts every day of a backfilled history with that day', async () => {
      await createCurrency({ code: 'USDT' });
      await seedMarket({ day: DAY_1, eurPerUsd: 0.5 });
      await seedMarket({ day: DAY_2, eurPerUsd: 0.5 });
      await seedMarket({ day: DAY_3, eurPerUsd: 0.25 });
      await setRates(pairRates({ code: 'USDT', rate: 1, effectiveDate: DAY_1 }));
      await setRates(pairRates({ code: 'USDT', rate: 2, effectiveDate: DAY_2 }));
      await setRates(pairRates({ code: 'USDT', rate: 3, effectiveDate: DAY_3 }));
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
      expect(rebuilt.map((row) => row.refAmountMissing)).toEqual([false, false, false]);
    }, 90000);
  });

  describe('backup', () => {
    it('restores every dated rate of a custom currency', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1, effectiveDate: DAY_1 }));
      await setRates(pairRates({ code: 'USDT', rate: 2, effectiveDate: DAY_3 }));

      const exported = await helpers.exportBackup();
      expect(exported.statusCode).toBe(200);
      const archive = helpers.parseBackupArchive({ buffer: exported.body });
      const exportedRates = archive.readData({ name: 'user-exchange-rates' }) as { effectiveDate: string }[];
      expect(exportedRates.map((row) => row.effectiveDate).toSorted()).toEqual([DAY_1, DAY_1, DAY_3, DAY_3]);

      await restoreArchive({ base64: exported.body.toString('base64') });

      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_2 })).toBe(1);
      expect(await rateValueOn({ from: 'USDT', to: QUOTE, day: DAY_3 })).toBe(2);
      expect((await snapshotUserRates()).filter((row) => row.baseCode === 'USDT')).toHaveLength(2);
    }, 90000);

    it('restores an archive written before rates were dated, dating each by the day it was saved', async () => {
      await setRates(pairRates({ code: QUOTE, rate: 5, quote: BASE() }));
      const exported = await helpers.exportBackup();
      const archive = helpers.parseBackupArchive({ buffer: exported.body });

      // What an export from before the column existed carried: no effectiveDate, no source.
      const savedAt = `${DAY_1}T23:59:59.000Z`;
      const oldRows = (archive.readData({ name: 'user-exchange-rates' }) as Record<string, unknown>[]).map((row) => {
        const { effectiveDate: _day, source: _source, ...rest } = row;
        return { ...rest, date: savedAt };
      });
      expect(oldRows).toHaveLength(2);
      archive.files.set('data/user-exchange-rates.json', Buffer.from(JSON.stringify(oldRows)));

      await restoreArchive({ base64: await helpers.repackBackup({ files: archive.files }) });

      const restored = await snapshotUserRates();
      expect(restored.map((row) => [row.baseCode, row.effectiveDate, row.source])).toEqual(
        [
          [BASE(), DAY_1, 'manual'],
          [QUOTE, DAY_1, 'manual'],
        ].toSorted((a, b) => `${a[0]}`.localeCompare(`${b[0]}`)),
      );
      // The applied rate is still the user's, for any day.
      expect(await rateValueOn({ from: QUOTE, to: BASE(), day: DAY_BEFORE })).toBe(5);
    }, 90000);
  });
});
