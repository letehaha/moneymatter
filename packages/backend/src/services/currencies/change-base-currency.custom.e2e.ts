import { type AccountApiResponse, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { beforeEach, describe, expect, it } from '@jest/globals';
import UserExchangeRates from '@models/user-exchange-rates.model';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as helpers from '@tests/helpers';
import { subDays } from 'date-fns';

const BASE = (): string => global.BASE_CURRENCY_CODE;
const NEW_BASE = 'EUR';
/** The ISO currency the custom code is priced in; neither the old nor the new base. */
const QUOTE = 'USD';

/** The user's own rate between `code` and `quote`, in both directions, as the endpoint requires. */
const pairRates = ({ code, rate, quote = QUOTE }: { code: string; rate: number; quote?: string }) => [
  { baseCode: code, quoteCode: quote, rate },
  { baseCode: quote, quoteCode: code, rate: 1 / rate },
];

/** A custom rate applies from the day it starts; these tests back-date their transactions, so it starts long ago. */
const RATE_START = '2000-01-01';

const setRates = (pairs: { baseCode: string; quoteCode: string; rate: number }[]) =>
  helpers.editCurrencyExchangeRate({
    pairs: pairs.map((pair) =>
      pair.baseCode === 'USDT' || pair.quoteCode === 'USDT' ? { ...pair, effectiveDate: RATE_START } : pair,
    ),
    raw: true,
  });

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

const threeDaysAgo = () => subDays(new Date(), 3);

const createTx = async ({
  accountId,
  amount,
  time = threeDaysAgo(),
}: {
  accountId: string;
  amount: number;
  time?: Date;
}) => {
  const response = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({
      accountId: accountId as RecordId,
      amount,
      categoryId: global.DEFAULT_CATEGORY_ID,
      transactionType: TRANSACTION_TYPES.income,
      time: time.toISOString(),
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

const historyOf = async ({ accountId }: { accountId: string }) =>
  (await helpers.getBalanceHistory({ accountId, raw: true })) as unknown as { date: string; amount: number }[];

const todayCents = async ({ accountId }: { accountId: string }) =>
  helpers.balanceCentsOn({ rows: await historyOf({ accountId }), date: new Date() });

/** Every rate row the user owns, in a stable order, as the base change must leave them. */
const snapshotUserRates = async () => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });
  const rows = await UserExchangeRates.findAll({ where: { userId }, raw: true });

  return rows.toSorted((a, b) => `${a.baseCode}${a.quoteCode}`.localeCompare(`${b.baseCode}${b.quoteCode}`));
};

describe('Change base currency with custom currency holdings', () => {
  beforeEach(async () => {
    await helpers.addUserCurrencies({ currencyCodes: [QUOTE, NEW_BASE], raw: true });
  });

  describe('with a rate for the custom currency', () => {
    it('crosses the stored quote into the new base like an ISO holding, leaving every rate row alone', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1 }));
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: QUOTE });
      const usdtTx = await createTx({ accountId: usdt.id, amount: 100 });
      const usdTx = await createTx({ accountId: usd.id, amount: 100 });
      expect(usdtTx.refAmount).not.toBeNull();
      expect(usdtTx.refAmount).toBe(usdTx.refAmount);

      const ratesBefore = await snapshotUserRates();

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE });
      helpers.expectBaseCurrencyChangeCompleted(status);

      const [usdtAfter, usdAfter] = await Promise.all([readTx({ id: usdtTx.id }), readTx({ id: usdTx.id })]);
      expect(usdtAfter.refCurrencyCode).toBe(NEW_BASE);
      expect(usdtAfter.refAmount).not.toBeNull();
      expect(usdtAfter.refAmount).not.toBe(usdtTx.refAmount);
      expect(usdtAfter.refAmountMissing).toBe(false);
      // A USDT priced 1:1 in USD is worth exactly what the USD holding is, on the same day.
      expect(usdtAfter.refAmount).toBe(usdAfter.refAmount);

      const [usdtAccount, usdAccount] = await Promise.all([readAccount({ id: usdt.id }), readAccount({ id: usd.id })]);
      expect(usdtAccount.currencyCode).toBe('USDT');
      expect(usdtAccount.currentBalance).toBe(100);
      expect(usdtAccount.refCurrentBalance).not.toBeNull();
      expect(usdtAccount.refCurrentBalance).toBe(usdAccount.refCurrentBalance);

      expect(await snapshotUserRates()).toEqual(ratesBefore);
    }, 60000);

    it('expresses the balance history of the custom account in the new base', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1 }));
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: QUOTE });
      await createTx({ accountId: usdt.id, amount: 100 });
      await createTx({ accountId: usd.id, amount: 100 });

      const beforeCents = await todayCents({ accountId: usdt.id });
      expect(beforeCents).toBeGreaterThan(0);
      expect(beforeCents).toBe(await todayCents({ accountId: usd.id }));

      helpers.expectBaseCurrencyChangeCompleted(await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE }));

      const afterCents = await todayCents({ accountId: usdt.id });
      expect(afterCents).toBeGreaterThan(0);
      expect(afterCents).not.toBe(beforeCents);
      expect(afterCents).toBe(await todayCents({ accountId: usd.id }));
      expect(afterCents).toBe(Math.round((await readAccount({ id: usdt.id })).refCurrentBalance! * 100));
    }, 60000);

    it('keeps an ISO manual rate untouched and values USDT and USD alike before and after the change', async () => {
      await createCurrency({ code: 'USDT' });
      // USDT is worth 1 USD; the user also set USD to EUR by hand.
      await setRates([
        ...pairRates({ code: 'USDT', rate: 1 }),
        ...pairRates({ code: QUOTE, rate: 0.95, quote: NEW_BASE }),
      ]);
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: QUOTE });
      const usdtTx = await createTx({ accountId: usdt.id, amount: 100 });
      const usdTx = await createTx({ accountId: usd.id, amount: 100 });

      const ratesBefore = await snapshotUserRates();

      helpers.expectBaseCurrencyChangeCompleted(await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE }));

      // The manual USD to EUR rate belongs to the new base only once the base is flipped, so the
      // rebuild itself values both legs from the market, and equally.
      const [usdtAfter, usdAfterRebuild] = await Promise.all([readTx({ id: usdtTx.id }), readTx({ id: usdTx.id })]);
      expect(usdtAfter.refAmount).not.toBeNull();
      expect(usdtAfter.refAmount).toBe(usdAfterRebuild.refAmount);
      expect(await snapshotUserRates()).toEqual(ratesBefore);

      // Later entries use the manual rate, for the custom holding exactly as for the USD one.
      const newUsdt = await createTx({ accountId: usdt.id, amount: 100, time: new Date() });
      const newUsd = await createTx({ accountId: usd.id, amount: 100, time: new Date() });
      expect(newUsd.refAmount).toBe(95);
      expect(newUsdt.refAmount).toBe(95);
      expect(await snapshotUserRates()).toEqual(ratesBefore);
    }, 60000);
  });

  describe('without a rate for the custom currency', () => {
    it('completes the change and leaves the custom rows without a base-currency amount', async () => {
      await createCurrency({ code: 'USDT' });
      const usdt = await createAccountIn({ code: 'USDT' });
      const usd = await createAccountIn({ code: QUOTE });
      const usdtTx = await createTx({ accountId: usdt.id, amount: 100 });
      const usdTx = await createTx({ accountId: usd.id, amount: 100 });
      expect(usdtTx.refAmountMissing).toBe(true);

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE });
      helpers.expectBaseCurrencyChangeCompleted(status);

      const [usdtAfter, usdAfter] = await Promise.all([readTx({ id: usdtTx.id }), readTx({ id: usdTx.id })]);
      expect(usdtAfter.refAmount).toBeNull();
      expect(usdtAfter.refAmountMissing).toBe(true);
      expect(usdtAfter.refCurrencyCode).toBe(NEW_BASE);
      expect(usdtAfter.amount).toBe(100);

      // The ISO holding converts as usual.
      expect(usdAfter.refAmount).not.toBeNull();
      expect(usdAfter.refAmount).not.toBe(usdTx.refAmount);
      expect(usdAfter.refAmountMissing).toBe(false);

      const account = await readAccount({ id: usdt.id });
      expect(account.currentBalance).toBe(100);
      expect(account.refCurrentBalance).toBeNull();
      expect((await readAccount({ id: usd.id })).refCurrentBalance).not.toBeNull();

      const newBase = (await helpers.getUserCurrencies()).find((item) => item.isDefaultCurrency)!;
      expect(newBase.currencyCode).toBe(NEW_BASE);
    }, 60000);

    it('values the account once the rate is entered after the change', async () => {
      await createCurrency({ code: 'USDT' });
      const usdt = await createAccountIn({ code: 'USDT' });
      await createTx({ accountId: usdt.id, amount: 100 });

      helpers.expectBaseCurrencyChangeCompleted(await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: NEW_BASE }));
      expect(await historyOf({ accountId: usdt.id })).toEqual([]);

      await setRates(pairRates({ code: 'USDT', rate: 0.9, quote: NEW_BASE }));

      expect((await readAccount({ id: usdt.id })).refCurrentBalance).toBe(90);
      expect(await todayCents({ accountId: usdt.id })).toBe(9000);
    }, 60000);
  });

  describe('a rate edit after the custom account has a history', () => {
    it('rebuilds the history when the custom rate itself changes', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1 }));
      const usdt = await createAccountIn({ code: 'USDT' });
      await createTx({ accountId: usdt.id, amount: 100 });
      const before = await todayCents({ accountId: usdt.id });
      expect(before).toBeGreaterThan(0);

      await setRates(pairRates({ code: 'USDT', rate: 2 }));

      // Doubling the rate doubles the value; the allowance is the day-to-day drift of the market leg.
      const ratio = (await todayCents({ accountId: usdt.id })) / before;
      expect(ratio).toBeGreaterThan(1.99);
      expect(ratio).toBeLessThan(2.01);
    }, 60000);

    it('rebuilds the history when the ISO rate of its stored quote changes', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates([...pairRates({ code: 'USDT', rate: 1 }), ...pairRates({ code: QUOTE, rate: 4, quote: BASE() })]);
      const usdt = await createAccountIn({ code: 'USDT' });
      await createTx({ accountId: usdt.id, amount: 100 });
      expect(await todayCents({ accountId: usdt.id })).toBe(40000);

      await setRates(pairRates({ code: QUOTE, rate: 5, quote: BASE() }));

      expect(await todayCents({ accountId: usdt.id })).toBe(50000);
    }, 60000);

    it('clears the history while the custom currency has no rate', async () => {
      await createCurrency({ code: 'USDT' });
      await setRates(pairRates({ code: 'USDT', rate: 1 }));
      const usdt = await createAccountIn({ code: 'USDT' });
      await createTx({ accountId: usdt.id, amount: 100 });
      expect(await todayCents({ accountId: usdt.id })).toBeGreaterThan(0);

      await helpers.removeCurrencyExchangeRate({
        pairs: [
          { baseCode: 'USDT', quoteCode: QUOTE },
          { baseCode: QUOTE, quoteCode: 'USDT' },
        ],
        raw: true,
      });

      expect(await historyOf({ accountId: usdt.id })).toEqual([]);
    }, 60000);
  });
});
