import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type AnyFn = (...args: unknown[]) => Promise<unknown>;

jest.mock('@models/users-currencies.model', () => ({ __esModule: true, default: { findOne: jest.fn() } }));

/* eslint-disable import/first */
import UsersCurrencies from '@models/users-currencies.model';

import { findPeg } from './peg';
/* eslint-enable import/first */

const findHeld = UsersCurrencies.findOne as unknown as jest.Mock<AnyFn>;

describe('findPeg', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('reads the peg currency and factor of a pegged currency', async () => {
    findHeld.mockResolvedValue({ rateSource: 'peg', rateSourceConfig: { pegCurrency: 'USD', factor: 1.5 } });

    expect(await findPeg({ userId: 1, code: 'USDT' })).toEqual({ kind: 'peg', quoteCode: 'USD', factor: 1.5 });
    expect(findHeld).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 1, currencyCode: 'USDT' } }));
  });

  it.each([
    ['a currency on manual rates', { rateSource: 'manual', rateSourceConfig: null }],
    ['a currency on a synced source', { rateSource: 'coingecko', rateSourceConfig: { coinId: 'bitcoin' } }],
    ['a currency the user does not hold', null],
  ])('reports no peg for %s', async (_name, held) => {
    findHeld.mockResolvedValue(held);

    expect(await findPeg({ userId: 1, code: 'USDT' })).toEqual({ kind: 'none' });
  });

  it.each([
    ['no config', null],
    ['an unknown key', { pegCurrency: 'USD', factor: 1, extra: true }],
    ['a non-positive factor', { pegCurrency: 'USD', factor: 0 }],
    ['a currency code of the wrong shape', { pegCurrency: 'U$D', factor: 1 }],
    ['a factor that is not a number', { pegCurrency: 'USD', factor: 'one' }],
  ])('reports an unreadable peg for %s', async (_name, rateSourceConfig) => {
    findHeld.mockResolvedValue({ rateSource: 'peg', rateSourceConfig });

    expect(await findPeg({ userId: 1, code: 'USDT' })).toEqual({ kind: 'invalid' });
  });
});
