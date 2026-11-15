import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const DIGITS_BY_CODE: Record<string, number> = { USD: 2, JPY: 0, KWD: 3 };

jest.mock('@models/currencies.model', () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

jest.mock('@models/users-currencies.model', () => ({
  __esModule: true,
  getBaseCurrency: jest.fn(),
}));

/* eslint-disable import/first */
import { ValidationError } from '@js/errors';
import { getBaseCurrency } from '@models/users-currencies.model';

import { roundToBaseCurrency } from './round-to-base-currency';
/* eslint-enable import/first */

const USER_ID = 1;

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

describe('roundToBaseCurrency', () => {
  beforeEach(() => {
    (getBaseCurrency as jest.Mock).mockReset();
  });

  it.each([
    { code: 'USD', value: '100.125', expected: '100.13' },
    { code: 'JPY', value: '1500.5', expected: '1501' },
    { code: 'KWD', value: '1.2345', expected: '1.235' },
  ])('rounds half-up to the $code base decimals', async ({ code, value, expected }) => {
    baseIs({ code });
    const [rounded] = await roundToBaseCurrency({ userId: USER_ID, values: [Money.fromDecimal(value)] });
    expect(rounded!.toString()).toBe(expected);
  });

  it('passes null and undefined through', async () => {
    baseIs({ code: 'JPY' });
    const rounded = await roundToBaseCurrency({
      userId: USER_ID,
      values: [null, undefined, Money.fromDecimal('2.5')],
    });
    expect(rounded[0]).toBeNull();
    expect(rounded[1]).toBeUndefined();
    expect(rounded[2]!.toString()).toBe('3');
  });

  it('does not look the base currency up when there is nothing to round', async () => {
    await expect(roundToBaseCurrency({ userId: USER_ID, values: [null, undefined] })).resolves.toEqual([
      null,
      undefined,
    ]);
    expect(getBaseCurrency).not.toHaveBeenCalled();
  });

  it('rejects a user without a base currency instead of keeping the values unrounded', async () => {
    baseIs({ code: null });
    await expect(roundToBaseCurrency({ userId: USER_ID, values: [Money.fromDecimal('1.005')] })).rejects.toThrow(
      ValidationError,
    );
  });
});
