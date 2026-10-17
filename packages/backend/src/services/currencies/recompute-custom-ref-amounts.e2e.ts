import {
  type AccountApiResponse,
  type RecordId,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as helpers from '@tests/helpers';
import { subDays } from 'date-fns';

const BASE = (): string => global.BASE_CURRENCY_CODE;
const MARKET_AED_PER_USD = 4;

const dayKey = ({ daysAgo }: { daysAgo: number }): string => subDays(new Date(), daysAgo).toISOString().slice(0, 10);
const noonOf = ({ day }: { day: string }): string => `${day}T12:00:00.000Z`;

// Distinct, recent days that no other suite seeds.
const DAY_1 = dayKey({ daysAgo: 21 });
const DAY_2 = dayKey({ daysAgo: 20 });
const DAY_3 = dayKey({ daysAgo: 19 });
const TODAY = dayKey({ daysAgo: 0 });

const createCurrency = async ({ code }: { code: string }) => {
  const response = await helpers.createCustomCurrency({ payload: { code, name: code, decimals: 6 } });
  expect(response.statusCode).toBe(201);
};

/** The user's rate of `code` into the base from one day on, in both directions as the endpoint requires. */
const datedRates = ({ code, rate, effectiveDate }: { code: string; rate: number; effectiveDate?: string }) => [
  { baseCode: code, quoteCode: BASE(), rate, effectiveDate },
  { baseCode: BASE(), quoteCode: code, rate: 1 / rate, effectiveDate },
];

const setRate = async ({ code, rate, effectiveDate }: { code: string; rate: number; effectiveDate?: string }) => {
  const response = await helpers.editCurrencyExchangeRate({
    pairs: datedRates({ code, rate, effectiveDate }),
    raw: false,
  });
  expect(response.statusCode).toBe(200);
};

const removeRate = async ({ code, effectiveDate }: { code: string; effectiveDate?: string }) => {
  const response = await helpers.removeCurrencyExchangeRate({
    pairs: [
      { baseCode: code, quoteCode: BASE(), effectiveDate },
      { baseCode: BASE(), quoteCode: code, effectiveDate },
    ],
    raw: false,
  });
  expect(response.statusCode).toBe(200);
};

const pegTo = async ({ code, pegCurrency, factor = 1 }: { code: string; pegCurrency: string; factor?: number }) => {
  const response = await helpers.setCurrencyRateSource({
    code,
    payload: { rateSource: 'peg', config: { pegCurrency, factor } },
  });
  expect(response.statusCode).toBe(200);
};

const createAccountIn = async ({ code }: { code: string }) => {
  const response = await helpers.createAccount({
    payload: helpers.buildAccountPayload({ currencyCode: code, name: `${code} account`, initialBalance: 0 }),
    raw: false,
  });
  expect(response.statusCode).toBe(200);

  return (response as unknown as { body: { response: AccountApiResponse } }).body.response;
};

const createTx = async ({
  accountId,
  amount,
  day = TODAY,
  extra = {},
}: {
  accountId: string;
  amount: number;
  day?: string;
  extra?: Partial<Parameters<typeof helpers.buildTransactionPayload>[0]>;
}) => {
  const response = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: accountId as RecordId,
      amount,
      categoryId: global.DEFAULT_CATEGORY_ID,
      transactionType: TRANSACTION_TYPES.expense,
      time: noonOf({ day }),
      ...extra,
    }),
    raw: false,
  });
  const body = response as unknown as { statusCode: number; body: { response: TransactionApiResponse[] } };
  if (body.statusCode !== 200) throw new Error(`createTransaction answered ${body.statusCode}`);

  return body.body.response;
};

const readTx = async ({ id }: { id: string }) =>
  (await helpers.getTransactionById({
    id: id as RecordId,
    includeSplits: true,
    raw: true,
  })) as unknown as TransactionApiResponse;

const readAccount = async ({ id }: { id: string }) =>
  (await helpers.getAccount({ id, raw: true })) as unknown as AccountApiResponse;

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
      await createCurrency({ code: 'USDT' });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [first] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      expect(first!.refAmount).toBe(30);

      await setRate({ code: 'USDT', rate: 4, effectiveDate: DAY_1 });

      expect((await readTx({ id: first!.id })).refAmount).toBe(40);
      const [second] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      expect(second!.refAmount).toBe(40);
      // 20 USDT spent, valued at today's rate.
      expect((await readAccount({ id: usdt.id })).refCurrentBalance).toBe(-80);
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

    it('values a currency pegged to the corrected one, and leaves a currency pegged to nothing alone', async () => {
      await createCurrency({ code: 'USDT' });
      await createCurrency({ code: 'USDC' });
      await createCurrency({ code: 'COIN' });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });
      await setRate({ code: 'COIN', rate: 7, effectiveDate: DAY_1 });
      await pegTo({ code: 'USDC', pegCurrency: 'USDT' });
      const usdc = await createAccountIn({ code: 'USDC' });
      const coin = await createAccountIn({ code: 'COIN' });
      const [pegged] = await createTx({ accountId: usdc.id, amount: 10, day: DAY_2 });
      const [unrelated] = await createTx({ accountId: coin.id, amount: 10, day: DAY_2 });
      expect([pegged!.refAmount, unrelated!.refAmount]).toEqual([10, 70]);

      await setRate({ code: 'USDT', rate: 2, effectiveDate: DAY_1 });

      expect((await readTx({ id: pegged!.id })).refAmount).toBe(20);
      expect((await readTx({ id: unrelated!.id })).refAmount).toBe(70);
    });

    it('values a currency whose own rate is quoted in the corrected one', async () => {
      await createCurrency({ code: 'USDT' });
      await createCurrency({ code: 'SAT' });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });
      // 1 SAT is worth 0.5 USDT, so the base value of SAT follows USDT's rate.
      const quoted = await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: 'SAT', quoteCode: 'USDT', rate: 0.5, effectiveDate: DAY_1 },
          { baseCode: 'USDT', quoteCode: 'SAT', rate: 2, effectiveDate: DAY_1 },
        ],
        raw: false,
      });
      expect(quoted.statusCode).toBe(200);
      const sat = await createAccountIn({ code: 'SAT' });
      const [created] = await createTx({ accountId: sat.id, amount: 10, day: DAY_2 });
      expect(created!.refAmount).toBe(5);

      await setRate({ code: 'USDT', rate: 2, effectiveDate: DAY_1 });

      expect((await readTx({ id: created!.id })).refAmount).toBe(10);
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

  describe('rates that start on a new day', () => {
    it('leaves a transaction that already has a value alone and values the next one at the new rate', async () => {
      await createCurrency({ code: 'USDT' });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [saved] = await createTx({ accountId: usdt.id, amount: 10, day: TODAY });
      expect(saved!.refAmount).toBe(30);

      // No effective date: the rate starts today.
      await setRate({ code: 'USDT', rate: 5 });

      expect((await readTx({ id: saved!.id })).refAmount).toBe(30);
      const [next] = await createTx({ accountId: usdt.id, amount: 10, day: TODAY });
      expect(next!.refAmount).toBe(50);
    });

    it('gives a transaction that was waiting for a rate its value, and not an earlier one', async () => {
      await createCurrency({ code: 'USDT' });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [waiting] = await createTx({ accountId: usdt.id, amount: 10, day: TODAY });
      const [older] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      expect([waiting!.refAmountMissing, older!.refAmountMissing]).toEqual([true, true]);

      await setRate({ code: 'USDT', rate: 3 });

      const filled = await readTx({ id: waiting!.id });
      expect([filled.refAmount, filled.refAmountMissing]).toEqual([30, false]);
      const stillWaiting = await readTx({ id: older!.id });
      expect([stillWaiting.refAmount, stillWaiting.refAmountMissing]).toEqual([null, true]);
    });
  });

  describe('a rate for a past day', () => {
    it('values the transactions it now covers, and not the days before it', async () => {
      await createCurrency({ code: 'USDT' });
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
    it('falls back to the rate before it, and to a missing value when there is none', async () => {
      await createCurrency({ code: 'USDT' });
      await setRate({ code: 'USDT', rate: 3, effectiveDate: DAY_1 });
      await setRate({ code: 'USDT', rate: 6, effectiveDate: DAY_2 });
      const usdt = await createAccountIn({ code: 'USDT' });
      const [created] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_3 });
      expect(created!.refAmount).toBe(60);

      await removeRate({ code: 'USDT', effectiveDate: DAY_2 });
      expect((await readTx({ id: created!.id })).refAmount).toBe(30);

      await removeRate({ code: 'USDT', effectiveDate: DAY_1 });
      const reloaded = await readTx({ id: created!.id });
      expect([reloaded.refAmount, reloaded.refAmountMissing]).toEqual([null, true]);
    });
  });

  describe('a new rate source', () => {
    it('values a transaction saved before any source existed, with the account balance and the stats', async () => {
      await createCurrency({ code: 'USDT' });
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: 'USD' });
      const [waiting] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      const [iso] = await createTx({ accountId: usd.id, amount: 10, day: DAY_2 });
      expect([waiting!.refAmount, waiting!.refAmountMissing]).toEqual([null, true]);
      expect(iso!.refAmount).toBe(40);
      expect((await readAccount({ id: usdt.id })).refCurrentBalance).toBeNull();

      // The market moves after the ISO transaction was saved: that one keeps the amount it was saved with.
      await helpers.seedUsdExchangeRates({
        date: new Date(`${DAY_2}T00:00:00.000Z`),
        ratesPerUsd: { AED: MARKET_AED_PER_USD * 2 },
      });
      await pegTo({ code: 'USDT', pegCurrency: BASE() });

      const valued = await readTx({ id: waiting!.id });
      expect([valued.refAmount, valued.refAmountMissing]).toEqual([10, false]);
      expect((await readTx({ id: iso!.id })).refAmount).toBe(40);
      expect((await readAccount({ id: usdt.id })).refCurrentBalance).toBe(-10);

      const spendings = (await helpers.getSpendingsByCategories({ raw: true })) as Record<string, { amount: number }>;
      expect(Object.values(spendings).reduce((sum, item) => sum + item.amount, 0)).toBe(50);
    });

    it('values a transaction pegged to a currency whose dated manual rate is corrected later', async () => {
      await createCurrency({ code: 'USDT' });
      await createCurrency({ code: 'USDC' });
      await setRate({ code: 'USDT', rate: 1, effectiveDate: DAY_1 });
      await pegTo({ code: 'USDC', pegCurrency: 'USDT' });
      const usdc = await createAccountIn({ code: 'USDC' });
      const [created] = await createTx({ accountId: usdc.id, amount: 10, day: DAY_2 });
      expect(created!.refAmount).toBe(10);

      await setRate({ code: 'USDT', rate: 2, effectiveDate: DAY_1 });

      expect((await readTx({ id: created!.id })).refAmount).toBe(20);
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

      const response = await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USD', quoteCode: BASE(), rate: 5 },
          { baseCode: BASE(), quoteCode: 'USD', rate: 0.2 },
        ],
        raw: false,
      });
      expect(response.statusCode).toBe(200);

      expect((await readTx({ id: created!.id })).refAmount).toBe(40);
    });

    it('values a custom currency again when the manual rate of the ISO currency it resolves through changes or goes', async () => {
      await createCurrency({ code: 'USDT' });
      await createCurrency({ code: 'SAT' });
      await pegTo({ code: 'USDT', pegCurrency: 'USD', factor: 2 });
      // A currency on manual rates, whose own rate is quoted in USD.
      const quoted = await helpers.editCurrencyExchangeRate({
        pairs: [
          { baseCode: 'SAT', quoteCode: 'USD', rate: 0.5, effectiveDate: DAY_1 },
          { baseCode: 'USD', quoteCode: 'SAT', rate: 2, effectiveDate: DAY_1 },
        ],
        raw: false,
      });
      expect(quoted.statusCode).toBe(200);
      const usdt = await createAccountIn({ code: 'USDT' });
      const sat = await createAccountIn({ code: 'SAT' });
      const [pegged] = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });
      const [stored] = await createTx({ accountId: sat.id, amount: 10, day: DAY_2 });
      // At the market rate of 4 per USD: 10 * 2 * 4 and 10 * 0.5 * 4.
      expect([pegged!.refAmount, stored!.refAmount]).toEqual([80, 20]);

      const usdRate = (rate: number) => [
        { baseCode: 'USD', quoteCode: BASE(), rate },
        { baseCode: BASE(), quoteCode: 'USD', rate: 1 / rate },
      ];
      const edit = await helpers.editCurrencyExchangeRate({ pairs: usdRate(5), raw: false });
      expect(edit.statusCode).toBe(200);

      expect((await readTx({ id: pegged!.id })).refAmount).toBe(100);
      expect((await readTx({ id: stored!.id })).refAmount).toBe(25);

      const removal = await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USD', quoteCode: BASE() },
          { baseCode: BASE(), quoteCode: 'USD' },
        ],
        raw: false,
      });
      expect(removal.statusCode).toBe(200);

      expect((await readTx({ id: pegged!.id })).refAmount).toBe(80);
      expect((await readTx({ id: stored!.id })).refAmount).toBe(20);
    });
  });
});
