import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const DIGITS_BY_CODE: Record<string, number> = { USD: 2, JPY: 0, KWD: 3, BTC: 8, XNN: 9 };

// `Currencies.digits` is the source of the decimals; the lookup is stubbed so the
// unit tests do not need a database.
jest.mock('@models/currencies.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('@models/users-currencies.model', () => ({
  __esModule: true,
  getBaseCurrency: jest.fn(),
}));

/* eslint-disable import/first */
import { NotFoundError, ValidationError } from '@js/errors';
import Currencies from '@models/currencies.model';
import { getBaseCurrency } from '@models/users-currencies.model';

import { invalidateCurrencyDecimalsCache } from './currency-decimals-cache';
import {
  assertMoneyWithinMinorUnitRange,
  getBaseCurrencyDecimals,
  getReportBaseCurrencyDecimals,
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
      await expect(getConversionDecimals({ userId: USER_ID, baseCode: 'USD', quoteCode: 'XXZ' })).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('getBaseCurrencyDecimals', () => {
    const baseIs = ({ code }: { code: string | null }) =>
      (getBaseCurrency as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockResolvedValue(
        code === null
          ? null
          : {
              userId: USER_ID,
              currencyCode: code,
              isDefaultCurrency: true,
              currency: { code, digits: DIGITS_BY_CODE[code] },
            },
      );

    it('reads the digits joined to the base currency without a second lookup', async () => {
      baseIs({ code: 'KWD' });
      await expect(getBaseCurrencyDecimals({ userId: USER_ID })).resolves.toBe(3);
      expect(Currencies.findOne).not.toHaveBeenCalled();
    });

    it('rejects a base currency with more than 8 decimals', async () => {
      baseIs({ code: 'XNN' });
      await expect(getBaseCurrencyDecimals({ userId: USER_ID })).rejects.toThrow('supported maximum of 8');
    });

    it('looks the base up for the given user', async () => {
      baseIs({ code: 'USD' });
      await getBaseCurrencyDecimals({ userId: 7 });
      expect(getBaseCurrency).toHaveBeenLastCalledWith({ userId: 7 });
    });

    it('rejects a user without a base currency instead of falling back to 2 decimals', async () => {
      baseIs({ code: null });
      await expect(getBaseCurrencyDecimals({ userId: USER_ID })).rejects.toThrow(ValidationError);
    });

    it('gives read-only reports 2 decimals for a user without a base currency', async () => {
      baseIs({ code: null });
      await expect(getReportBaseCurrencyDecimals({ userId: USER_ID })).resolves.toBe(2);

      baseIs({ code: 'JPY' });
      await expect(getReportBaseCurrencyDecimals({ userId: USER_ID })).resolves.toBe(0);
    });
  });

  describe('getCurrencyDecimals', () => {
    it.each([
      ['USD', 2],
      ['JPY', 0],
      ['KWD', 3],
    ])('returns the digits of %s', async (code, digits) => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code })).resolves.toBe(digits);
    });

    it('throws for an unknown code', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'ZZZ' })).rejects.toThrow(NotFoundError);
    });

    it('accepts 8 decimals and rejects a currency with more', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'BTC' })).resolves.toBe(8);
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'XNN' })).rejects.toThrow('supported maximum of 8');
    });

    it('reads the database once per code, whichever user asks', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: 2, code: 'JPY' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(1);
    });

    it('does not cache an unknown code', async () => {
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'ZZZ' })).rejects.toThrow(NotFoundError);
      await expect(getCurrencyDecimals({ userId: USER_ID, code: 'ZZZ' })).rejects.toThrow(NotFoundError);
      expect(Currencies.findOne).toHaveBeenCalledTimes(2);
    });

    it('reads again after the cache is invalidated', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      invalidateCurrencyDecimalsCache({ code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(2);
    });

    it('keeps entries of other codes when one code is invalidated', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'KWD' });
      invalidateCurrencyDecimalsCache({ code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'KWD' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(2);
    });

    it('drops every code when no code is given', async () => {
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'KWD' });
      invalidateCurrencyDecimalsCache();
      await getCurrencyDecimals({ userId: USER_ID, code: 'JPY' });
      await getCurrencyDecimals({ userId: USER_ID, code: 'KWD' });
      expect(Currencies.findOne).toHaveBeenCalledTimes(4);
    });
  });

  describe('roundToCurrency', () => {
    it.each<[string, 'half-up' | 'half-even', string, number]>([
      ['USD', 'half-up', '12.176673309', 12.18],
      ['USD', 'half-up', '0.125', 0.13],
      ['USD', 'half-up', '-0.125', -0.13],
      ['KWD', 'half-up', '1.2345', 1.235],
      ['JPY', 'half-up', '1500.6', 1501],
      ['JPY', 'half-up', '1500.5', 1501],
      ['JPY', 'half-up', '-1500.5', -1501],
      ['USD', 'half-even', '0.125', 0.12],
      ['USD', 'half-even', '-0.125', -0.12],
      ['USD', 'half-even', '0.135', 0.14],
      ['KWD', 'half-even', '0.0025', 0.002],
      ['JPY', 'half-even', '2.5', 2],
      ['JPY', 'half-even', '3.5', 4],
    ])('rounds %s %s: %s -> %s', async (currencyCode, mode, value, expected) => {
      expect((await round({ value, currencyCode, mode })).toNumber()).toBe(expected);
    });

    it('throws for an unknown code', async () => {
      await expect(round({ value: 1, currencyCode: 'ZZZ', mode: 'half-up' })).rejects.toThrow(NotFoundError);
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
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('assertMoneyWithinMinorUnitRange', () => {
    it.each([
      { decimals: 0, max: '9007199254740991', overMax: '9007199254740992' },
      { decimals: 2, max: '90071992547409.91', overMax: '90071992547409.92' },
      { decimals: 3, max: '9007199254740.991', overMax: '9007199254740.992' },
      { decimals: 8, max: '90071992.54740991', overMax: '90071992.54740992' },
    ])('at $decimals decimals accepts $max and rejects $overMax', ({ decimals, max, overMax }) => {
      const check = (value: string) =>
        assertMoneyWithinMinorUnitRange({ money: Money.fromDecimal(value), decimals, code: 'XXX' });

      expect(() => check(max)).not.toThrow();
      expect(() => check(`-${max}`)).not.toThrow();
      expect(() => check(overMax)).toThrow(ValidationError);
      expect(() => check(`-${overMax}`)).toThrow(ValidationError);
    });

    it('is applied by the rounding helpers', async () => {
      await expect(round({ value: '9007199254740.992', currencyCode: 'KWD', mode: 'half-up' })).rejects.toThrow(
        ValidationError,
      );
      await expect(round({ value: '9007199254740.991', currencyCode: 'KWD', mode: 'half-up' })).resolves.toBeDefined();
    });
  });
});
