import { type AccountApiResponse, type RecordId, TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { TransactionApiResponse } from '@root/serializers/transactions.serializer';
import * as helpers from '@tests/helpers';
import { subDays } from 'date-fns';

const BASE = (): string => global.BASE_CURRENCY_CODE;
const QUOTE = 'USD';
/** What the market says one dollar is worth in the test user's base (AED) on the seeded days. */
const MARKET_AED_PER_USD = 4;

const dayKey = ({ daysAgo }: { daysAgo: number }): string => subDays(new Date(), daysAgo).toISOString().slice(0, 10);
const dayDate = ({ day }: { day: string }): Date => new Date(`${day}T00:00:00.000Z`);
const noonOf = ({ day }: { day: string }): string => `${day}T12:00:00.000Z`;

// Distinct, recent days that no other suite seeds.
const DAY_1 = dayKey({ daysAgo: 15 });
const DAY_2 = dayKey({ daysAgo: 14 });
const SEEDED_DAYS = [DAY_1, DAY_2];

const createCurrency = async ({ code }: { code: string }) => {
  const response = await helpers.createCustomCurrency({ payload: { code, name: code, decimals: 6 } });
  expect(response.statusCode).toBe(201);
};

const pegTo = async ({ code, pegCurrency, factor = 1 }: { code: string; pegCurrency: string; factor?: number }) => {
  const response = await helpers.setCurrencyRateSource({
    code,
    payload: { rateSource: 'peg', config: { pegCurrency, factor } },
  });
  expect(response.statusCode).toBe(200);
};

const setManualRates = async ({
  code,
  rate,
  quote,
  effectiveDate,
}: {
  code: string;
  rate: number;
  quote: string;
  effectiveDate: string;
}) =>
  helpers.editCurrencyExchangeRate({
    pairs: [
      { baseCode: code, quoteCode: quote, rate, effectiveDate },
      { baseCode: quote, quoteCode: code, rate: 1 / rate, effectiveDate },
    ],
    raw: true,
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
      transactionType: TRANSACTION_TYPES.income,
      time: noonOf({ day }),
    }),
    raw: false,
  });
  const body = response as unknown as { statusCode: number; body: { response: TransactionApiResponse[] } };
  if (body.statusCode !== 200) throw new Error(`createTransaction answered ${body.statusCode}`);

  return body.body.response[0]!;
};

const rateOn = async ({ from, to, day }: { from: string; to: string; day: string }) =>
  helpers.getExchangeRatePair({ from, to, date: day, raw: false });

describe('Pegged currencies', () => {
  beforeEach(async () => {
    await helpers.addUserCurrencies({ currencyCodes: [QUOTE], raw: true });
    for (const day of SEEDED_DAYS) {
      await helpers.seedUsdExchangeRates({ date: dayDate({ day }), ratesPerUsd: { AED: MARKET_AED_PER_USD } });
    }
  });

  afterEach(async () => {
    await helpers.clearExchangeRatesForDates({ dates: SEEDED_DAYS.map((day) => dayDate({ day })) });
  });

  it('values a currency pegged to the base currency at the transaction amount', async () => {
    await createCurrency({ code: 'USDT' });
    await pegTo({ code: 'USDT', pegCurrency: BASE() });
    const usdt = await createAccountIn({ code: 'USDT' });

    const created = await createTx({ accountId: usdt.id, amount: 12.345678, day: DAY_1 });

    expect(created.refAmount).toBe(12.35);
    expect(created.refAmountMissing).toBe(false);
  });

  it('crosses the peg currency into the base with the market rate of the transaction day', async () => {
    await createCurrency({ code: 'USDT' });
    await pegTo({ code: 'USDT', pegCurrency: QUOTE, factor: 1 });
    const usdt = await createAccountIn({ code: 'USDT' });

    const created = await createTx({ accountId: usdt.id, amount: 10, day: DAY_2 });

    expect(created.refAmount).toBe(10 * MARKET_AED_PER_USD);
    expect(await rateOn({ from: 'USDT', to: QUOTE, day: DAY_2 }).then((r) => r.body.response)).toMatchObject({
      rate: 1,
    });
  });

  it('applies the factor, and the reverse direction is its inverse', async () => {
    await createCurrency({ code: 'USDT' });
    await pegTo({ code: 'USDT', pegCurrency: QUOTE, factor: 4 });

    const forward = await rateOn({ from: 'USDT', to: QUOTE, day: DAY_1 });
    const backward = await rateOn({ from: QUOTE, to: 'USDT', day: DAY_1 });

    expect((forward.body.response as { rate: number }).rate).toBe(4);
    expect((backward.body.response as { rate: number }).rate).toBe(0.25);
  });

  it('prefers the peg over rates the user entered before pegging the currency', async () => {
    await createCurrency({ code: 'USDT' });
    await setManualRates({ code: 'USDT', rate: 5, quote: QUOTE, effectiveDate: DAY_1 });
    await pegTo({ code: 'USDT', pegCurrency: BASE() });
    const usdt = await createAccountIn({ code: 'USDT' });

    const created = await createTx({ accountId: usdt.id, amount: 10, day: DAY_1 });

    expect(created.refAmount).toBe(10);
  });

  it('goes back to the stored rates when the peg is switched back to manual', async () => {
    await createCurrency({ code: 'USDT' });
    await setManualRates({ code: 'USDT', rate: 5, quote: QUOTE, effectiveDate: DAY_1 });
    await pegTo({ code: 'USDT', pegCurrency: BASE() });
    const switched = await helpers.setCurrencyRateSource({ code: 'USDT', payload: { rateSource: 'manual' } });
    expect(switched.statusCode).toBe(200);
    const usdt = await createAccountIn({ code: 'USDT' });

    const created = await createTx({ accountId: usdt.id, amount: 10, day: DAY_1 });

    // 5 USD per USDT at 4 AED per USD
    expect(created.refAmount).toBe(10 * 5 * MARKET_AED_PER_USD);
  });

  it('follows a peg onto a custom currency through its dated manual rate', async () => {
    await createCurrency({ code: 'USDT' });
    await createCurrency({ code: 'USDC' });
    await setManualRates({ code: 'USDT', rate: 1, quote: QUOTE, effectiveDate: DAY_1 });
    await setManualRates({ code: 'USDT', rate: 2, quote: QUOTE, effectiveDate: DAY_2 });
    await pegTo({ code: 'USDC', pegCurrency: 'USDT' });
    const usdc = await createAccountIn({ code: 'USDC' });

    const first = await createTx({ accountId: usdc.id, amount: 10, day: DAY_1 });
    const second = await createTx({ accountId: usdc.id, amount: 10, day: DAY_2 });

    expect(first.refAmount).toBe(10 * MARKET_AED_PER_USD);
    expect(second.refAmount).toBe(20 * MARKET_AED_PER_USD);
  });

  it('treats a peg cycle as unavailable: no rate, and a flagged transaction instead of a hang', async () => {
    await createCurrency({ code: 'USDT' });
    await createCurrency({ code: 'USDC' });
    await pegTo({ code: 'USDT', pegCurrency: 'USDC' });
    await pegTo({ code: 'USDC', pegCurrency: 'USDT' });
    const usdt = await createAccountIn({ code: 'USDT' });

    expect((await rateOn({ from: 'USDT', to: QUOTE, day: DAY_1 })).statusCode).toBe(404);
    expect((await rateOn({ from: QUOTE, to: 'USDC', day: DAY_1 })).statusCode).toBe(404);

    const created = await createTx({ accountId: usdt.id, amount: 10, day: DAY_1 });

    expect(created.refAmount).toBeNull();
    expect(created.refAmountMissing).toBe(true);
  });
});
