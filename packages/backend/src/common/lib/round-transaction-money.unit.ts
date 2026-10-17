import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const DIGITS_BY_CODE: Record<string, number> = { USD: 2, JPY: 0, KWD: 3, BTC: 8 };

jest.mock('@models/currencies.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

/* eslint-disable import/first */
import Currencies from '@models/currencies.model';

import { invalidateCurrencyDecimalsCache } from './currency-decimals-cache';
import { roundTransactionMoney } from './round-transaction-money';
/* eslint-enable import/first */

const USER_ID = 1;

const money = (value: string) => Money.fromDecimal(value);

describe('roundTransactionMoney', () => {
  beforeEach(() => {
    invalidateCurrencyDecimalsCache();
    (Currencies.findOne as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockImplementation(async (options) => {
      const code = (options as { where: { code: string } }).where.code;
      const digits = DIGITS_BY_CODE[code];
      return digits === undefined ? null : { code, digits };
    });
  });

  it('rounds the entered amounts half-up to the account currency decimals', async () => {
    const result = await roundTransactionMoney({
      values: { amount: money('1.2345'), commissionRate: money('0.0005'), cashbackAmount: money('0.0004') },
      userId: USER_ID,
      currencyCode: 'KWD',
      refCurrencyCode: 'USD',
      originalCurrencyCode: null,
    });

    expect(result.amount!.toDecimalString(3)).toBe('1.235');
    expect(result.commissionRate!.toDecimalString(3)).toBe('0.001');
    expect(result.cashbackAmount!.toDecimalString(3)).toBe('0.000');
  });

  it('rounds the converted amounts half-even to the reference currency decimals', async () => {
    const result = await roundTransactionMoney({
      values: { refAmount: money('0.025'), refCommissionRate: money('0.035') },
      userId: USER_ID,
      currencyCode: 'JPY',
      refCurrencyCode: 'USD',
      originalCurrencyCode: null,
    });

    expect(result.refAmount!.toDecimalString(2)).toBe('0.02');
    expect(result.refCommissionRate!.toDecimalString(2)).toBe('0.04');
  });

  it('rounds the original amount to the original currency, not the account currency', async () => {
    const result = await roundTransactionMoney({
      values: { amount: money('12.5'), originalAmount: money('1500.6') },
      userId: USER_ID,
      currencyCode: 'USD',
      refCurrencyCode: 'USD',
      originalCurrencyCode: 'JPY',
    });

    expect(result.amount!.toNumber()).toBe(12.5);
    expect(result.originalAmount!.toNumber()).toBe(1501);
  });

  it('falls back to the account currency for the reference values of a row without a reference currency', async () => {
    const result = await roundTransactionMoney({
      values: { refAmount: money('1.2345') },
      userId: USER_ID,
      currencyCode: 'KWD',
      refCurrencyCode: undefined,
      originalCurrencyCode: undefined,
    });

    expect(result.refAmount!.toDecimalString(3)).toBe('1.234');
  });

  it('leaves absent fields absent and a cleared original amount cleared', async () => {
    const result = await roundTransactionMoney({
      values: { amount: money('3.456'), originalAmount: null },
      userId: USER_ID,
      currencyCode: 'USD',
      refCurrencyCode: 'USD',
      originalCurrencyCode: null,
    });

    expect(result.amount!.toNumber()).toBe(3.46);
    expect(result.originalAmount).toBeNull();
    expect('commissionRate' in result).toBe(false);
    expect('refAmount' in result).toBe(false);
  });

  it('keeps the 8 decimals of a crypto currency', async () => {
    const result = await roundTransactionMoney({
      values: { amount: money('0.000406419') },
      userId: USER_ID,
      currencyCode: 'BTC',
      refCurrencyCode: 'USD',
      originalCurrencyCode: null,
    });

    expect(result.amount!.toDecimalString(8)).toBe('0.00040642');
  });
});
