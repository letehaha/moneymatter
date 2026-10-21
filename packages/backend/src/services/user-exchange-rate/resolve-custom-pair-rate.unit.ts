import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@models/user-exchange-rates.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));

/* eslint-disable import/first */
import { ExchangeRateUnavailableError } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';

import { resolveCustomPairRate } from './resolve-custom-pair-rate';
/* eslint-enable import/first */

const findRate = UserExchangeRates.findOne as unknown as jest.Mock<AnyFn>;

const DATE = new Date('2026-10-17T00:00:00.000Z');

/** Stored user rates keyed by `base>quote`; a lookup by base alone returns the first one for that base. */
const storeRates = (rates: Record<string, number>) => {
  findRate.mockImplementation(async (options) => {
    const { baseCode, quoteCode } = (options as { where: { baseCode: string; quoteCode?: string } }).where;
    const key = Object.keys(rates).find((candidate) => {
      const [base, quote] = candidate.split('>');
      return base === baseCode && (quoteCode === undefined || quote === quoteCode);
    });
    if (!key) return null;
    const [base, quote] = key.split('>');
    return { baseCode: base, quoteCode: quote, rate: rates[key], date: DATE };
  });
};

/** What production answers: any code that names a custom currency, whether or not it is in the pair. */
const CUSTOM_CODES = new Set(['SAT', 'USDT', 'USDC', 'BTC', 'AAA', 'BBB', 'COIN']);
const isCustomCode = async (code: string) => CUSTOM_CODES.has(code);

const isoRates = (rates: Record<string, number>) =>
  jest.fn(async ({ baseCode, quoteCode }: { baseCode: string; quoteCode: string }) => {
    const rate = rates[`${baseCode}>${quoteCode}`];
    if (rate === undefined) throw new ExchangeRateUnavailableError({ message: 'no market rate' });
    return { baseCode, quoteCode, date: DATE, rate };
  });

describe('resolveCustomPairRate', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('uses the rate the user entered for exactly this pair, with its full precision', async () => {
    storeRates({ 'SAT>USD': 0.00067123456789 });
    const resolveIsoRate = isoRates({});

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'SAT', quoteCode: 'USD' },
      date: DATE,
      isCustomCode,
      resolveIsoRate,
    });

    expect(result).toMatchObject({ baseCode: 'SAT', quoteCode: 'USD', rate: 0.00067123456789, custom: true });
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('crosses the stored quote into the target with the ISO resolution', async () => {
    storeRates({ 'USDT>USD': 1 });
    const resolveIsoRate = isoRates({ 'USD>EUR': 0.95 });

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'USDT', quoteCode: 'EUR' },
      date: DATE,
      isCustomCode,
      resolveIsoRate,
    });

    expect(result.rate).toBe(0.95);
    expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'USD', quoteCode: 'EUR' });
  });

  it('prices a custom target through its own stored quote', async () => {
    storeRates({ 'BTC>USD': 50000 });

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'EUR', quoteCode: 'BTC' },
      date: DATE,
      isCustomCode,
      resolveIsoRate: isoRates({ 'EUR>USD': 1.1 }),
    });

    expect(result.rate).toBeCloseTo(1.1 / 50000, 15);
  });

  it('follows a chain of custom currencies down to an ISO one', async () => {
    storeRates({ 'USDC>USDT': 1, 'USDT>USD': 0.999 });

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'USDC', quoteCode: 'EUR' },
      date: DATE,
      isCustomCode,
      resolveIsoRate: isoRates({ 'USD>EUR': 0.9 }),
    });

    expect(result.rate).toBeCloseTo(0.8991, 12);
  });

  it('answers with no conversion when both sides land on the same ISO currency', async () => {
    storeRates({ 'USDT>USD': 1, 'USDC>USD': 1 });
    const resolveIsoRate = isoRates({});

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'USDT', quoteCode: 'USDC' },
      date: DATE,
      isCustomCode,
      resolveIsoRate,
    });

    expect(result.rate).toBe(1);
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('is unavailable when the user has no rate for the custom currency', async () => {
    storeRates({});

    await expect(
      resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'SAT', quoteCode: 'USD' },
        date: DATE,
        isCustomCode,
        resolveIsoRate: isoRates({}),
      }),
    ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });

  it('is unavailable for a loop of custom currencies that the pair does not name, instead of walking it forever', async () => {
    // Only AAA is in the pair; BBB is reached through the stored quote of AAA.
    storeRates({ 'AAA>BBB': 1, 'BBB>AAA': 1 });
    const resolveIsoRate = isoRates({});

    await expect(
      resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'AAA', quoteCode: 'USD' },
        date: DATE,
        isCustomCode,
        resolveIsoRate,
      }),
    ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('never hands a custom code to the ISO resolution when the quote of a custom code is custom', async () => {
    storeRates({ 'SAT>COIN': 2, 'COIN>USD': 3 });
    const resolveIsoRate = isoRates({ 'USD>EUR': 0.5 });

    const result = await resolveCustomPairRate({
      userId: 1,
      pair: { baseCode: 'SAT', quoteCode: 'EUR' },
      date: DATE,
      isCustomCode,
      resolveIsoRate,
    });

    expect(result.rate).toBe(3);
    expect(resolveIsoRate).toHaveBeenCalledTimes(1);
    expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'USD', quoteCode: 'EUR' });
  });

  it('passes through the failure of the ISO leg', async () => {
    storeRates({ 'USDT>USD': 1 });

    await expect(
      resolveCustomPairRate({
        userId: 1,
        pair: { baseCode: 'USDT', quoteCode: 'JPY' },
        date: DATE,
        isCustomCode,
        resolveIsoRate: isoRates({}),
      }),
    ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });
});
