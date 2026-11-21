import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@services/common/with-transaction', () => ({ withTransaction: (fn: unknown) => fn }));
jest.mock('@services/user-exchange-rate', () => ({ getExchangeRate: jest.fn() }));
jest.mock('@services/currencies/custom-currency-codes', () => ({
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
import { includesCustomCurrencyCode } from '@services/currencies/custom-currency-codes';
import { refAmountCache } from '@services/ref-amount-cache';
import * as userExchangeRateService from '@services/user-exchange-rate';

import { calculateRefAmount } from './calculate-ref-amount.service';
/* eslint-enable import/first */

const getExchangeRate = userExchangeRateService.getExchangeRate as unknown as jest.Mock<AnyFn>;
const includesCustom = includesCustomCurrencyCode as unknown as jest.Mock<AnyFn>;
const cacheRead = refAmountCache.read as unknown as jest.Mock<AnyFn>;
const cacheWrite = refAmountCache.write as unknown as jest.Mock<AnyFn>;

const params = (baseCode: string) => ({
  userId: 1,
  definitionOwnerUserId: 1,
  amount: Money.fromDecimal(10),
  baseCode,
  quoteCode: 'USD',
  date: new Date('2026-10-17T00:00:00.000Z'),
});

describe('calculateRefAmount cache', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    cacheRead.mockResolvedValue(null);
    getExchangeRate.mockResolvedValue({ rate: 2 });
  });

  it('caches an ISO conversion', async () => {
    includesCustom.mockResolvedValue(false);

    await calculateRefAmount(params('EUR'));

    expect(cacheRead).toHaveBeenCalled();
    expect(cacheWrite).toHaveBeenCalled();
  });

  it('never reads or writes the cache for a custom currency, whose decimals depend on the definition owner', async () => {
    includesCustom.mockResolvedValue(true);

    const result = await calculateRefAmount(params('SAT'));

    expect(result.toNumber()).toBe(20);
    expect(cacheRead).not.toHaveBeenCalled();
    expect(cacheWrite).not.toHaveBeenCalled();
  });
});
