import { type RecordId, TRANSACTION_TRANSFER_NATURE } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

const BASE = (): string => global.BASE_CURRENCY_CODE;
const MARKET_AED_PER_USD = 4;

const {
  addCustomCurrency: createCurrency,
  createAccountInCurrency: createAccountIn,
  createTxOn: createTx,
  dayKey,
  pegTo,
  readTx,
  removeUserRate: removeRate,
  setUserRate: setRate,
} = helpers;

// Distinct, recent days that no other suite seeds.
const DAY_1 = dayKey({ daysAgo: 21 });
const DAY_2 = dayKey({ daysAgo: 20 });
const DAY_3 = dayKey({ daysAgo: 19 });
const TOMORROW = dayKey({ daysAgo: -1 });

describe('Valuing saved rows again after the rates of a custom currency change', () => {
  beforeEach(async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
    await helpers.seedUsdExchangeRates({
      date: new Date(`${DAY_2}T00:00:00.000Z`),
      ratesPerUsd: { AED: MARKET_AED_PER_USD },
    });
  });

  afterEach(async () => {
    await helpers.clearExchangeRatesForDates({ dates: [new Date(`${DAY_2}T00:00:00.000Z`)] });
  });

  describe('a corrected manual rate', () => {
    it('values the saved transactions and every later one at the corrected rate', async () => {
      await createCurrency({ code: 'USDT', rate: 4 });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [first] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2, extra: { commissionRate: 1 } });
      expect([first!.refAmount, first!.refCommissionRate]).toEqual([30, 3]);

      await setRate({ code: 'USDT', rate: 4, effectiveDate: DAY_1 });

      const corrected = await readTx({ id: first!.id });
      expect([corrected.refAmount, corrected.refCommissionRate]).toEqual([40, 4]);
      const [second] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      expect(second!.refAmount).toBe(40);
      // 20 USDT spent, valued at today's rate: the first one, which starts today.
      expect((await helpers.readAccount({ accountId: usdt.id })).refCurrentBalance).toBe(-80);
    });

    it('values the splits of a transaction with it', async () => {
      await createCurrency({ code: 'USDT' });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const categories = await helpers.getCategoriesList();
      const [created] = await createTx({
        accountId: usdt.id,
        amount: 10,
        day: DAY_2,
        extra: {
          splits: [
            { categoryId: categories[0]!.id, amount: 4 },
            { categoryId: categories[1]!.id, amount: 6 },
          ],
        },
      });
      expect((await readTx({ id: created!.id })).splits!.map((split) => split.refAmount).toSorted()).toEqual([12, 18]);

      await setRate({ code: 'USDT', rate: 5, effectiveDate: DAY_1 });

      const reloaded = await readTx({ id: created!.id });
      expect(reloaded.refAmount).toBe(50);
      expect(reloaded.splits!.map((split) => split.refAmount).toSorted()).toEqual([20, 30]);
    });

    it('values only the days the corrected rate covers', async () => {
      await createCurrency({ code: 'USDT' });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });
      await setRate({ code: 'USDT', rate: 6, effectiveDate: DAY_3 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [early] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      const [late] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_3 });
      expect([early!.refAmount, late!.refAmount]).toEqual([30, 60]);

      await setRate({ code: 'USDT', rate: 4, effectiveDate: DAY_1 });

      expect((await readTx({ id: early!.id })).refAmount).toBe(40);
      expect((await readTx({ id: late!.id })).refAmount).toBe(60);
    });

    it('leaves a currency pegged to an ISO currency alone when another custom rate is corrected', async () => {
      await createCurrency({ code: 'USDC' });
      await createCurrency({ code: 'COIN', rate: 7 });
      await setRate({ code: 'COIN', rate: 7, effectiveDate: DAY_1 });
      await pegTo({ code: 'USDC', pegCurrency: BASE() });
      const usdc = await createAccountIn({ code: 'USDC' });
      const coin = await createAccountIn({ code: 'COIN' });
      const [pegged] = await createTx({ accountId: usdc.id, amount: 10, day: DAY_2 });
      const [corrected] = await createTx({ accountId: coin.id, amount: 10, day: DAY_2 });
      expect([pegged!.refAmount, corrected!.refAmount]).toEqual([10, 70]);

      await setRate({ code: 'COIN', rate: 8, effectiveDate: DAY_1 });

      expect((await readTx({ id: pegged!.id })).refAmount).toBe(10);
      expect((await readTx({ id: corrected!.id })).refAmount).toBe(80);
    });

    it('keeps the base-currency value of a transfer leg that is anchored to a base-currency leg', async () => {
      await createCurrency({ code: 'USDT' });
      await setRate({ code: 'USDT', rate: 3.6, effectiveDate: DAY_1 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const base = await createAccountIn({ code: BASE() });
      const [source, destination] = await createTx({
        accountId: usdt.id,
        amount: 10,
        day: DAY_2,
        extra: {
          transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
          destinationAccountId: base.id as RecordId,
          destinationAmount: 36.7,
        },
      });
      const [plain] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });

      await setRate({ code: 'USDT', rate: 4, effectiveDate: DAY_1 });

      expect((await readTx({ id: source!.id })).refAmount).toBe(36.7);
      expect((await readTx({ id: destination!.id })).refAmount).toBe(36.7);
      expect((await readTx({ id: plain!.id })).refAmount).toBe(40);
    });
  });

  describe('a rate re-quoted in another currency', () => {
    it('values a transaction priced by the only rate again when that rate is replaced in another quote', async () => {
      await createCurrency({ code: 'USDT', rate: 3 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [saved] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      expect(saved!.refAmount).toBe(30);

      // Today's rate in USD replaces the rate in the base, which also priced every earlier day.
      await setRate({ code: 'USDT', quote: 'USD', rate: 2 });

      expect((await readTx({ id: saved!.id })).refAmount).toBe(10 * 2 * MARKET_AED_PER_USD);
    });
  });

  describe('a rate that starts on a new day', () => {
    it('leaves a transaction that already has a value alone and values the next one at the new rate', async () => {
      await createCurrency({ code: 'USDT', rate: 3 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [saved] = await createTx({ accountId: usdt.id, amount: 10, day: TOMORROW });
      expect(saved!.refAmount).toBe(30);

      await setRate({ code: 'USDT', rate: 5, effectiveDate: TOMORROW });

      expect((await readTx({ id: saved!.id })).refAmount).toBe(30);
      const [next] = await createTx({ accountId: usdt.id, amount: 10, day: TOMORROW });
      expect(next!.refAmount).toBe(50);
    });
  });

  describe('a rate for a past day', () => {
    it('values the transactions it now covers, and not the days before it', async () => {
      await createCurrency({ code: 'USDT', rate: 3 });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [before] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_1 });
      const [covered] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_3 });
      expect([before!.refAmount, covered!.refAmount]).toEqual([30, 30]);

      await setRate({ code: 'USDT', rate: 6, effectiveDate: DAY_2 });

      expect((await readTx({ id: before!.id })).refAmount).toBe(30);
      expect((await readTx({ id: covered!.id })).refAmount).toBe(60);
    });
  });

  describe('a removed rate', () => {
    it('falls back to the rate before it, and before the first rate to the earliest one', async () => {
      await createCurrency({ code: 'USDT', rate: 9 });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });
      await setRate({ code: 'USDT', rate: 6, effectiveDate: DAY_2 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [created] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_3 });
      expect(created!.refAmount).toBe(60);

      await removeRate({ code: 'USDT', effectiveDate: DAY_2 });
      expect((await readTx({ id: created!.id })).refAmount).toBe(30);

      // The rate that starts today is the only one left, so it values every earlier day.
      await removeRate({ code: 'USDT', effectiveDate: DAY_1 });
      expect((await readTx({ id: created!.id })).refAmount).toBe(90);
    });
  });

  describe('a new rate source', () => {
    it('values a transaction saved on manual rates again, with the account balance and the stats', async () => {
      await createCurrency({ code: 'USDT', rate: 3 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: 'USD' });
      const funded = await createAccountIn({ code: 'USDT', initialBalance: 100 });
      expect((await helpers.readAccount({ accountId: funded.id })).refInitialBalance).toBe(300);
      const [saved] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      const [iso] = await createTx({ accountId: usd.id, amount: 10, day: DAY_2 });
      expect(saved!.refAmount).toBe(30);
      expect(iso!.refAmount).toBe(40);
      expect((await helpers.readAccount({ accountId: usdt.id })).refCurrentBalance).toBe(-30);

      // The market moves after the ISO transaction was saved: that one keeps the amount it was saved with.
      await helpers.seedUsdExchangeRates({
        date: new Date(`${DAY_2}T00:00:00.000Z`),
        ratesPerUsd: { AED: MARKET_AED_PER_USD * 2 },
      });
      await pegTo({ code: 'USDT', pegCurrency: BASE() });

      expect((await readTx({ id: saved!.id })).refAmount).toBe(10);
      expect((await readTx({ id: iso!.id })).refAmount).toBe(40);
      expect((await helpers.readAccount({ accountId: usdt.id })).refCurrentBalance).toBe(-10);
      expect((await helpers.readAccount({ accountId: funded.id })).refInitialBalance).toBe(100);

      const spendings = (await helpers.getSpendingsByCategories({ raw: true })) as Record<string, { amount: number }>;
      expect(Object.values(spendings).reduce((sum, item) => sum + item.amount, 0)).toBe(50);
    });

    it('values a currency pegged to the base currency at the transaction amount', async () => {
      await createCurrency({ code: 'USDT', rate: 7 });
      await pegTo({ code: 'USDT', pegCurrency: BASE() });
      const usdt = await createAccountIn({ code: 'USDT' });

      const [created] = await createTx({ accountId: usdt.id, amount: 12.345678, day: DAY_1 });

      expect(created!.refAmount).toBe(12.35);
    });

    it('does not value anything again when the saved source is the same', async () => {
      await createCurrency({ code: 'USDT' });
      await pegTo({ code: 'USDT', pegCurrency: BASE() });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [created] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      const before = await readTx({ id: created!.id });

      await pegTo({ code: 'USDT', pegCurrency: BASE() });

      const after = await readTx({ id: created!.id });
      expect(after.refAmount).toBe(10);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });
  });

  describe('currencies of the ISO standard', () => {
    it('keeps the base amounts a transaction was saved with when the user sets a manual rate', async () => {
      const usd = await createAccountIn({ code: 'USD' });
      const [created] = await createTx({ accountId: usd.id, amount: 10, day: DAY_2 });
      expect(created!.refAmount).toBe(40);

      await setRate({ code: 'USD', rate: 5 });

      expect((await readTx({ id: created!.id })).refAmount).toBe(40);
    });

    it('values a custom currency again when the manual rate of the ISO currency it resolves through changes or goes', async () => {
      await createCurrency({ code: 'USDT', quote: 'USD' });
      await createCurrency({ code: 'SAT', rate: 0.5, quote: 'USD' });
      await pegTo({ code: 'USDT', pegCurrency: 'USD', factor: 2 });
      // A currency on manual rates, whose own rate is quoted in USD.
      await setRate({ code: 'SAT', quote: 'USD', rate: 0.5, effectiveDate: DAY_1 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const sat = await createAccountIn({ code: 'SAT' });
      const [pegged] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      const [stored] = await createTx({ accountId: sat.id, amount: 10, day: DAY_2 });
      // At the market rate of 4 per USD: 10 * 2 * 4 and 10 * 0.5 * 4.
      expect([pegged!.refAmount, stored!.refAmount]).toEqual([80, 20]);

      await setRate({ code: 'USD', rate: 5 });

      expect((await readTx({ id: pegged!.id })).refAmount).toBe(100);
      expect((await readTx({ id: stored!.id })).refAmount).toBe(25);

      await removeRate({ code: 'USD' });

      expect((await readTx({ id: pegged!.id })).refAmount).toBe(80);
      expect((await readTx({ id: stored!.id })).refAmount).toBe(20);
    });

    it('values a custom currency again when the ISO currency it is pegged to moves between the market and its manual rate', async () => {
      await createCurrency({ code: 'USDT' });
      await pegTo({ code: 'USDT', pegCurrency: 'USD', factor: 2 });
      await setRate({ code: 'USD', rate: 5 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [pegged] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      // The manual rate of 5 per USD: 10 * 2 * 5.
      expect(pegged!.refAmount).toBe(100);

      // The market rate of 4 per USD takes over, and back.
      const live = await helpers.updateUserCurrency({
        currency: { currencyCode: 'USD', liveRateUpdate: true },
        raw: false,
      });
      expect(live.statusCode).toBe(200);
      expect((await readTx({ id: pegged!.id })).refAmount).toBe(80);

      const manual = await helpers.updateUserCurrency({
        currency: { currencyCode: 'USD', liveRateUpdate: false },
        raw: false,
      });
      expect(manual.statusCode).toBe(200);
      expect((await readTx({ id: pegged!.id })).refAmount).toBe(100);
    });
  });
});
