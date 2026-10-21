import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@services/common/with-transaction', () => ({ withTransaction: (fn: unknown) => fn }));
jest.mock('@services/user-exchange-rate', () => ({ getExchangeRate: jest.fn() }));
jest.mock('@services/currencies/custom-currency-codes', () => ({
  findCustomCurrencyCodes: jest.fn(),
  includesCustomCurrencyCode: jest.fn(),
}));
jest.mock('@services/ref-amount-cache', () => ({
  buildRefAmountCacheKey: () => 'key',
  serializeRefAmountCacheValue: ({ amount }: { amount: { toNumber: () => number } }) => String(amount.toNumber()),
  refAmountCache: { read: jest.fn(), write: jest.fn() },
}));
jest.mock('@common/lib/currency-precision', () => ({
  getConversionDecimals: jest.fn(async () => ({ baseDecimals: 8, quoteDecimals: 2 })),
}));
jest.mock('@models/users-currencies.model', () => ({ getCurrency: jest.fn() }));
jest.mock('@models/currencies.model', () => ({}));
jest.mock('@i18n/index', () => ({ t: ({ key }: { key: string }) => key }));

/* eslint-disable import/first */
import { Money } from '@common/types/money';
import { ExchangeRateUnavailableError } from '@js/errors';
import { includesCustomCurrencyCode, findCustomCurrencyCodes } from '@services/currencies/custom-currency-codes';
import { refAmountCache } from '@services/ref-amount-cache';
import * as userExchangeRateService from '@services/user-exchange-rate';

import { calculateRefAmount, calculateRefAmountOrNull } from './calculate-ref-amount.service';
/* eslint-enable import/first */

const getExchangeRate = userExchangeRateService.getExchangeRate as unknown as jest.Mock<AnyFn>;
const findCustom = findCustomCurrencyCodes as unknown as jest.Mock<AnyFn>;
const includesCustom = includesCustomCurrencyCode as unknown as jest.Mock<AnyFn>;
const cacheRead = refAmountCache.read as unknown as jest.Mock<AnyFn>;
const cacheWrite = refAmountCache.write as unknown as jest.Mock<AnyFn>;

const params = (baseCode: string) => ({
  userId: 1,
  amount: Money.fromDecimal(10),
  baseCode,
  quoteCode: 'USD',
  date: new Date('2026-10-17T00:00:00.000Z'),
});

describe('calculateRefAmountOrNull', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    cacheRead.mockResolvedValue(null);
  });

  it('answers null for a custom currency that has no rate', async () => {
    findCustom.mockResolvedValue(new Set(['SAT']));
    includesCustom.mockResolvedValue(true);
    getExchangeRate.mockRejectedValue(new ExchangeRateUnavailableError({ message: 'no rate' }));

    await expect(calculateRefAmountOrNull(params('SAT'))).resolves.toBeNull();
  });

  it('answers zero for a zero amount of a custom currency that has no rate', async () => {
    findCustom.mockResolvedValue(new Set(['SAT']));
    includesCustom.mockResolvedValue(true);
    getExchangeRate.mockRejectedValue(new ExchangeRateUnavailableError({ message: 'no rate' }));

    const result = await calculateRefAmountOrNull({ ...params('SAT'), amount: Money.zero() });

    expect(result?.isZero()).toBe(true);
  });

  it('keeps throwing for an ISO currency that has no rate', async () => {
    findCustom.mockResolvedValue(new Set());
    includesCustom.mockResolvedValue(false);
    getExchangeRate.mockRejectedValue(new ExchangeRateUnavailableError({ message: 'no rate' }));

    await expect(calculateRefAmountOrNull(params('EUR'))).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });

  it('does not swallow other failures of a custom currency', async () => {
    findCustom.mockResolvedValue(new Set(['SAT']));
    includesCustom.mockResolvedValue(true);
    getExchangeRate.mockRejectedValue(new Error('database is down'));

    await expect(calculateRefAmountOrNull(params('SAT'))).rejects.toThrow('database is down');
  });

  it('converts at the user rate when there is one', async () => {
    findCustom.mockResolvedValue(new Set(['SAT']));
    getExchangeRate.mockResolvedValue({ rate: 0.5 });

    const result = await calculateRefAmountOrNull(params('SAT'));

    expect(result?.toNumber()).toBe(5);
  });
});

describe('calculateRefAmount cache', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    cacheRead.mockResolvedValue(null);
    getExchangeRate.mockResolvedValue({ rate: 2 });
  });

  it('caches an ISO conversion', async () => {
    findCustom.mockResolvedValue(new Set());

    await calculateRefAmount(params('EUR'));

    expect(cacheRead).toHaveBeenCalled();
    expect(cacheWrite).toHaveBeenCalled();
  });

  it('never reads or writes the cache for a custom currency, whose rate the user can change at any time', async () => {
    findCustom.mockResolvedValue(new Set(['SAT']));

    const result = await calculateRefAmount(params('SAT'));

    expect(result.toNumber()).toBe(20);
    expect(cacheRead).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
  });
});
