import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const DIGITS_BY_CODE: Record<string, number> = { USD: 2, JPY: 0, KWD: 3 };

// `Currencies.digits` is the source of the decimals; the lookup is stubbed so the
// unit tests do not need a database.
jest.mock('@models/currencies.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('@models/users-currencies.model', () => ({
  __esModule: true,
  getBaseCurrency: jest.fn(),
  default: { findOne: jest.fn() },
}));

/* eslint-disable import/first */
import Currencies from '@models/currencies.model';
import UsersCurrencies, { getBaseCurrency } from '@models/users-currencies.model';

import { invalidateCurrencyDecimalsCache } from './currency-decimals-cache';
import {
  assertMoneyFitsCurrency,
  getBaseCurrencyDecimals,
  getConversionDecimals,
  getCurrencyDecimals,
  roundMoneyValues,
  roundToCurrency,
} from './currency-precision';
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
  describe('getCurrencyDecimals with custom currencies', () => {
    const OTHER_USER_ID = 2;
    const overrideByUser: Record<number, number | null> = { [USER_ID]: 8, [OTHER_USER_ID]: 0 };

    beforeEach(() => {
      invalidateCurrencyDecimalsCache();
      (Currencies.findOne as jest.Mock).mockClear();
      (UsersCurrencies.findOne as jest.Mock).mockClear();
      (Currencies.findOne as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockImplementation(
        async (options) => {
          const code = (options as { where: { code: string } }).where.code;
          if (code === 'SAT') return { code, digits: 4, isCustom: true };
          if (code === 'USD') return { code, digits: 2, isCustom: false };
          return null;
        },
      );
      (UsersCurrencies.findOne as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockImplementation(
        async (options) => {
          const userId = (options as { where: { userId: number } }).where.userId;
          return userId in overrideByUser ? { decimalsOverride: overrideByUser[userId] } : null;
        },
      );
    });

    it("prefers the user's own decimals over the global row, and keeps users apart", async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'SAT' })).resolves.toBe(8);
      await expect(getCurrencyDecimals({ userId: OTHER_USER_ID, code: 'SAT' })).resolves.toBe(0);
    });

    it('falls back to the global digits for a user who holds no override', async () => {
      await expect(getCurrencyDecimals({ userId: 3, code: 'SAT' })).resolves.toBe(4);
    });

    it('does not look for an override on an ISO currency', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'USD' })).resolves.toBe(2);
      expect(UsersCurrencies.findOne).not.toHaveBeenCalled();
    });

    it('serves the cached value until the cache is invalidated for the user and code', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'SAT' });
      overrideByUser[USER_ID] = 2;

      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'SAT' })).resolves.toBe(8);

      invalidateCurrencyDecimalsCache({ userId: USER_ID, code: 'SAT' });
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'SAT' })).resolves.toBe(2);

      overrideByUser[USER_ID] = 8;
    });

    it("rounds a conversion's native side with the owner's definition when one is given", async () => {
      await expect(
        getConversionDecimals({ userId: OTHER_USER_ID, baseCode: 'SAT', quoteCode: 'USD', baseOwnerUserId: USER_ID }),
      ).resolves.toEqual({ baseDecimals: 8, quoteDecimals: 2 });
      await expect(
        getConversionDecimals({ userId: OTHER_USER_ID, baseCode: 'SAT', quoteCode: 'USD' }),
      ).resolves.toEqual({
        baseDecimals: 0,
        quoteDecimals: 2,
      });
    });
  });

  beforeEach(() => {
    invalidateCurrencyDecimalsCache();
    (Currencies.findOne as jest.Mock).mockClear();
    (Currencies.findOne as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockImplementation(async (options) => {
      const code = (options as { where: { code: string } }).where.code;
      const digits = DIGITS_BY_CODE[code];
      return digits === undefined ? null : { code, digits };
    });
  });

  describe('getConversionDecimals', () => {
    it('returns the decimals of both currencies of the conversion', async () => {
      await expect(getConversionDecimals({ userId: USER_ID, baseCode: 'JPY', quoteCode: 'KWD' })).resolves.toEqual({
        baseDecimals: 0,
        quoteDecimals: 3,
      });
    });

    it('rejects an unknown currency instead of falling back to 2 decimals', async () => {
      await expect(getConversionDecimals({ userId: USER_ID, baseCode: 'USD', quoteCode: 'XXZ' })).rejects.toThrow();
    });
  });

  describe('getBaseCurrencyDecimals', () => {
    const baseIs = ({ code }: { code: string | null }) =>
      (getBaseCurrency as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockResolvedValue(
        code === null ? null : { userId: USER_ID, currencyCode: code, isDefaultCurrency: true },
      );

    it('returns 2 for a USD base', async () => {
      baseIs({ code: 'USD' });
      await expect(getBaseCurrencyDecimals({ userId: USER_ID })).resolves.toBe(2);
    });

    it('returns 3 for a KWD base', async () => {
      baseIs({ code: 'KWD' });
      await expect(getBaseCurrencyDecimals({ userId: USER_ID })).resolves.toBe(3);
    });

    it('returns 0 for a JPY base', async () => {
      baseIs({ code: 'JPY' });
      await expect(getBaseCurrencyDecimals({ userId: USER_ID })).resolves.toBe(0);
    });

    it('looks the base up for the given user', async () => {
      baseIs({ code: 'USD' });
      await getBaseCurrencyDecimals({ userId: 7 });
      expect(getBaseCurrency).toHaveBeenLastCalledWith({ userId: 7 });
    });

    it('rejects a user without a base currency instead of falling back to 2 decimals', async () => {
      baseIs({ code: null });
      await expect(getBaseCurrencyDecimals({ userId: USER_ID })).rejects.toThrow();
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
  describe('roundMoneyValues', () => {
    it('rounds every present value half-up to the currency decimals', async () => {
      const result = await roundMoneyValues({
        values: { amount: Money.fromDecimal('1.2345'), commission: Money.fromDecimal('0.0005') },
        userId: USER_ID,
        currencyCode: 'KWD',
        mode: 'half-up',
      });

      expect(result.amount.toNumber()).toBe(1.235);
      expect(result.commission.toNumber()).toBe(0.001);
    });

    it('rounds half-even when asked to', async () => {
      const result = await roundMoneyValues({
        values: { amount: Money.fromDecimal('0.125') },
        userId: USER_ID,
        currencyCode: 'USD',
        mode: 'half-even',
      });

      expect(result.amount.toNumber()).toBe(0.12);
    });

    it('keeps null and undefined as they are', async () => {
      const result = await roundMoneyValues({
        values: { cleared: null, omitted: undefined, amount: Money.fromDecimal('1500.6') },
        userId: USER_ID,
        currencyCode: 'JPY',
        mode: 'half-up',
      });

      expect(result.cleared).toBeNull();
      expect(result.omitted).toBeUndefined();
      expect(result.amount!.toNumber()).toBe(1501);
    });

    it('does not read the currency when there is nothing to round', async () => {
      const values = { omitted: undefined, cleared: null };

      await expect(roundMoneyValues({ values, userId: USER_ID, currencyCode: 'ZZZ', mode: 'half-up' })).resolves.toBe(
        values,
      );
      expect(Currencies.findOne).not.toHaveBeenCalled();
    });

    it('throws for an unknown code when there is something to round', async () => {
      await expect(
        roundMoneyValues({
          values: { amount: Money.fromDecimal(1) },
          userId: USER_ID,
          currencyCode: 'ZZZ',
          mode: 'half-up',
        }),
      ).rejects.toThrow();
    });
  });

  describe('assertMoneyFitsCurrency', () => {
    const assertFits = ({ value, currencyCode }: { value: string; currencyCode: string }) =>
      assertMoneyFitsCurrency({ money: Money.fromDecimal(value), userId: USER_ID, currencyCode });

    it('accepts an amount with the currency decimals or fewer', async () => {
      await expect(assertFits({ value: '12.34', currencyCode: 'USD' })).resolves.toBeUndefined();
      await expect(assertFits({ value: '12', currencyCode: 'USD' })).resolves.toBeUndefined();
      await expect(assertFits({ value: '1.234', currencyCode: 'KWD' })).resolves.toBeUndefined();
      await expect(assertFits({ value: '1500', currencyCode: 'JPY' })).resolves.toBeUndefined();
    });

    it('rejects an amount with more decimals than the currency carries', async () => {
      await expect(assertFits({ value: '12.345', currencyCode: 'USD' })).rejects.toThrow();
      await expect(assertFits({ value: '1.2345', currencyCode: 'KWD' })).rejects.toThrow();
      await expect(assertFits({ value: '1500.5', currencyCode: 'JPY' })).rejects.toThrow();
    });
  });
});
