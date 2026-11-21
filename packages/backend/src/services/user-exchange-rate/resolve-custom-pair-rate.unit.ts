import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@models/user-exchange-rates.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn(), findAll: jest.fn() },
}));
jest.mock('@services/currencies/custom-currency-codes', () => ({ findCustomCurrencyCodes: jest.fn() }));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));

/* eslint-disable import/first */
import { ExchangeRateUnavailableError } from '@js/errors';
import UserExchangeRates from '@models/user-exchange-rates.model';
import { findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';

import { resolveCustomPairRate } from './resolve-custom-pair-rate';
/* eslint-enable import/first */

const findRate = UserExchangeRates.findOne as unknown as jest.Mock<AnyFn>;
const findRates = UserExchangeRates.findAll as unknown as jest.Mock<AnyFn>;
const findCustom = findCustomCurrencyCodes as unknown as jest.Mock<AnyFn>;

const DATE = new Date('2026-10-17T00:00:00.000Z');
const CUSTOM_CODES = new Set(['SAT', 'USDT', 'USDC', 'BTC', 'COIN', 'DUST']);

/** Stored user rates keyed by `base>quote`. */
const storeRates = (rates: Record<string, number>) => {
  const rows = Object.entries(rates).map(([key, rate]) => {
    const [baseCode, quoteCode] = key.split('>');
    return { baseCode: baseCode!, quoteCode: quoteCode!, rate, date: DATE };
  });

  findRate.mockImplementation(async (options) => {
    const { baseCode, quoteCode } = (options as { where: { baseCode: string; quoteCode: string } }).where;
    return rows.find((row) => row.baseCode === baseCode && row.quoteCode === quoteCode) ?? null;
  });
  findRates.mockImplementation(async (options) => {
    const { baseCode } = (options as { where: { baseCode: string } }).where;
    return rows.filter((row) => row.baseCode === baseCode).toSorted((a, b) => a.quoteCode.localeCompare(b.quoteCode));
  });
};

const isoRates = (rates: Record<string, number>) =>
  jest.fn(async ({ baseCode, quoteCode }: { baseCode: string; quoteCode: string }) => {
    const rate = rates[`${baseCode}>${quoteCode}`];
    if (rate === undefined) throw new ExchangeRateUnavailableError({ message: 'no market rate' });
    return { baseCode, quoteCode, date: DATE, rate };
  });

const resolve = ({
  pair,
  resolveIsoRate,
}: {
  pair: { baseCode: string; quoteCode: string };
  resolveIsoRate: ReturnType<typeof isoRates>;
}) => resolveCustomPairRate({ userId: 1, pair, date: DATE, resolveIsoRate });

describe('resolveCustomPairRate', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    findCustom.mockImplementation(
      async (options) => new Set((options as { codes: string[] }).codes.filter((code) => CUSTOM_CODES.has(code))),
    );
  });

  it('uses the rate the user entered for exactly this pair, with its full precision', async () => {
    storeRates({ 'SAT>USD': 0.00067123456789 });
    const resolveIsoRate = isoRates({});

    const result = await resolve({ pair: { baseCode: 'SAT', quoteCode: 'USD' }, resolveIsoRate });

    expect(result).toMatchObject({ baseCode: 'SAT', quoteCode: 'USD', rate: 0.00067123456789, custom: true });
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('crosses the stored ISO quote into the target with the ISO resolution', async () => {
    storeRates({ 'USDT>USD': 1 });
    const resolveIsoRate = isoRates({ 'USD>EUR': 0.95 });

    const result = await resolve({ pair: { baseCode: 'USDT', quoteCode: 'EUR' }, resolveIsoRate });

    expect(result.rate).toBe(0.95);
    expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'USD', quoteCode: 'EUR' });
  });

  it('prices a custom target through its own stored quote', async () => {
    storeRates({ 'BTC>USD': 50000 });

    const result = await resolve({
      pair: { baseCode: 'EUR', quoteCode: 'BTC' },
      resolveIsoRate: isoRates({ 'EUR>USD': 1.1 }),
    });

    expect(result.rate).toBeCloseTo(1.1 / 50000, 15);
  });

  it('prefers the quote that matches the other side, whatever order the rates were written in', async () => {
    storeRates({ 'COIN>USD': 3, 'COIN>EUR': 2 });
    const resolveIsoRate = isoRates({});

    const result = await resolve({ pair: { baseCode: 'USD', quoteCode: 'COIN' }, resolveIsoRate });

    expect(result.rate).toBeCloseTo(1 / 3, 12);
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('falls back to the first ISO quote by code and ignores a custom quote', async () => {
    storeRates({ 'COIN>SAT': 100, 'COIN>USD': 3, 'COIN>EUR': 2 });
    const resolveIsoRate = isoRates({ 'EUR>GBP': 0.5 });

    const result = await resolve({ pair: { baseCode: 'COIN', quoteCode: 'GBP' }, resolveIsoRate });

    expect(result.rate).toBe(1);
    expect(resolveIsoRate).toHaveBeenCalledWith({ baseCode: 'EUR', quoteCode: 'GBP' });
  });

  it('keeps the significant digits of a rate far below 1e-15', async () => {
    storeRates({ 'DUST>USD': 1.23456789e-15 });

    const result = await resolve({
      pair: { baseCode: 'DUST', quoteCode: 'EUR' },
      resolveIsoRate: isoRates({ 'USD>EUR': 0.92 }),
    });

    expect(result.rate / 1.1358024588e-15).toBeCloseTo(1, 12);
  });

  it('answers with no conversion when both sides land on the same ISO currency', async () => {
    storeRates({ 'USDT>USD': 1, 'USDC>USD': 1 });
    const resolveIsoRate = isoRates({});

    const result = await resolve({ pair: { baseCode: 'USDT', quoteCode: 'USDC' }, resolveIsoRate });

    expect(result.rate).toBe(1);
    expect(resolveIsoRate).not.toHaveBeenCalled();
  });

  it('is unavailable when the user has no ISO-quoted rate for the custom currency', async () => {
    storeRates({ 'SAT>COIN': 2 });

    await expect(
      resolve({ pair: { baseCode: 'SAT', quoteCode: 'USD' }, resolveIsoRate: isoRates({}) }),
    ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });

  it('passes through the failure of the ISO leg', async () => {
    storeRates({ 'USDT>USD': 1 });

    await expect(
      resolve({ pair: { baseCode: 'USDT', quoteCode: 'JPY' }, resolveIsoRate: isoRates({}) }),
    ).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });
});
