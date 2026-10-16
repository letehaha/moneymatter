import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const DIGITS_BY_CODE: Record<string, number> = { USD: 2, JPY: 0, KWD: 3 };

// `Currencies.digits` is the source of the decimals; the lookup is stubbed so the
// unit tests do not need a database.
jest.mock('@models/currencies.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

/* eslint-disable import/first */
import Currencies from '@models/currencies.model';

import { invalidateCurrencyDecimalsCache } from './currency-decimals-cache';
import { getCurrencyDecimals, roundToCurrency } from './currency-precision';
/* eslint-enable import/first */

const USER_ID = 1;

const round = ({
  value,
  currencyCode,
  mode,
}: {
  value: number | string;
  currencyCode: string;
  mode: 'half-up' | 'half-even';
}) =>
  roundToCurrency({
    money: Money.fromDecimal(value),
    userId: USER_ID,
    currencyCode,
    mode,
  });

describe('currency precision helpers', () => {
  beforeEach(() => {
    invalidateCurrencyDecimalsCache();
    (Currencies.findOne as jest.Mock).mockClear();
    (Currencies.findOne as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockImplementation(async (options) => {
      const code = (options as { where: { code: string } }).where.code;
      const digits = DIGITS_BY_CODE[code];
      return digits === undefined ? null : { code, digits };
    });
  });

  describe('getCurrencyDecimals', () => {
    it('returns 2 for USD', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'USD' })).resolves.toBe(2);
    });

    it('returns 0 for JPY', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'JPY' })).resolves.toBe(0);
    });

    it('returns 3 for KWD', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'KWD' })).resolves.toBe(3);
    });

    it('throws for an unknown code', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'ZZZ' })).rejects.toThrow();
    });

    it('reads the database once per user and code', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(1);

      await getCurrencyDecimals({ userId: 2, code: 'JPY' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(2);
    });

    it('does not cache an unknown code', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'ZZZ' })).rejects.toThrow();
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'ZZZ' })).rejects.toThrow();
      expect(Currencies.findOne).toHaveBeenCalledTimes(2);
    });

    it('reads again after the cache is invalidated', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      invalidateCurrencyDecimalsCache({ code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(2);
    });

    it('keeps entries of other codes and users when one code is invalidated', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'KWD' });
      invalidateCurrencyDecimalsCache({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'KWD' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(2);
    });

    it('drops every code of a user when only the user is given', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'KWD' });
      invalidateCurrencyDecimalsCache({ userId: USER_ID });
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'KWD' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(4);
    });
  });

  describe('roundToCurrency', () => {
    it('rounds USD to 2 decimals', async () => {
      const result = await round({
        value: '12.176673309',
        currencyCode: 'USD',
        mode: 'half-up',
      });
      expect(result.toNumber()).toBe(12.18);
    });

    it('rounds JPY to whole units', async () => {
      const result = await round({
        value: 1500.6,
        currencyCode: 'JPY',
        mode: 'half-up',
      });
      expect(result.toNumber()).toBe(1501);
    });

    it('keeps 3 decimals for KWD', async () => {
      const result = await round({
        value: '1.2345',
        currencyCode: 'KWD',
        mode: 'half-up',
      });
      expect(result.toNumber()).toBe(1.235);
    });

    it('throws for an unknown code', async () => {
      await expect(round({ value: 1, currencyCode: 'ZZZ', mode: 'half-up' })).rejects.toThrow();
    });

    describe('at an exact tie', () => {
      it('half-up rounds away from zero', async () => {
        expect(
          (
            await round({
              value: '0.125',
              currencyCode: 'USD',
              mode: 'half-up',
            })
          ).toNumber(),
        ).toBe(0.13);
        expect(
          (
            await round({
              value: '-0.125',
              currencyCode: 'USD',
              mode: 'half-up',
            })
          ).toNumber(),
        ).toBe(-0.13);
      });

      it('half-even rounds to the even neighbour', async () => {
        expect(
          (
            await round({
              value: '0.125',
              currencyCode: 'USD',
              mode: 'half-even',
            })
          ).toNumber(),
        ).toBe(0.12);
        expect(
          (
            await round({
              value: '-0.125',
              currencyCode: 'USD',
              mode: 'half-even',
            })
          ).toNumber(),
        ).toBe(-0.12);
        expect(
          (
            await round({
              value: '0.135',
              currencyCode: 'USD',
              mode: 'half-even',
            })
          ).toNumber(),
        ).toBe(0.14);
      });

      it('half-even applies at the currency decimals, not at 2', async () => {
        expect(
          (
            await round({
              value: '0.0025',
              currencyCode: 'KWD',
              mode: 'half-even',
            })
          ).toNumber(),
        ).toBe(0.002);
        expect(
          (
            await round({
              value: '2.5',
              currencyCode: 'JPY',
              mode: 'half-even',
            })
          ).toNumber(),
        ).toBe(2);
        expect(
          (
            await round({
              value: '3.5',
              currencyCode: 'JPY',
              mode: 'half-even',
            })
          ).toNumber(),
        ).toBe(4);
      });
    });
  });
});
