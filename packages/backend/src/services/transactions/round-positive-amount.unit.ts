import { Money } from '@common/types/money';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const DIGITS_BY_CODE: Record<string, number> = { USD: 2, JPY: 0, KWD: 3 };

jest.mock('@models/currencies.model', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(async ({ where: { code } }: { where: { code: string } }) => ({
      code,
      digits: DIGITS_BY_CODE[code],
    })),
  },
}));

jest.mock('@models/users-currencies.model', () => ({
  __esModule: true,
  getBaseCurrency: jest.fn(),
}));

/* eslint-disable import/first */
import { ValidationError } from '@js/errors';
import { getBaseCurrency } from '@models/users-currencies.model';

import { roundPositiveAmount, roundPositiveBaseAmount } from './round-positive-amount';
/* eslint-enable import/first */

const USER_ID = 1;

const baseIs = ({ code }: { code: string | null }) =>
  (getBaseCurrency as jest.Mock<(...args: unknown[]) => Promise<unknown>>).mockResolvedValue(
    code === null ? null : { currencyCode: code, currency: { code, digits: DIGITS_BY_CODE[code] } },
  );

const CASES = [
  { code: 'USD', value: '100.125', expected: '100.13', belowUnit: '0.004' },
  { code: 'JPY', value: '1500.5', expected: '1501', belowUnit: '0.4' },
  { code: 'KWD', value: '1.2345', expected: '1.235', belowUnit: '0.0004' },
];

describe('roundPositiveAmount', () => {
  it.each(CASES)(
    'rounds half-up to $code decimals and refuses $belowUnit',
    async ({ code, value, expected, belowUnit }) => {
      const rounded = await roundPositiveAmount({
        money: Money.fromDecimal(value),
        userId: USER_ID,
        currencyCode: code,
      });
      expect(rounded.toString()).toBe(expected);

      await expect(
        roundPositiveAmount({ money: Money.fromDecimal(belowUnit), userId: USER_ID, currencyCode: code }),
      ).rejects.toThrow(ValidationError);
    },
  );
});

describe('roundPositiveBaseAmount', () => {
  beforeEach(() => {
    (getBaseCurrency as jest.Mock).mockReset();
  });

  it.each(CASES)(
    'rounds to the $code base decimals and refuses $belowUnit',
    async ({ code, value, expected, belowUnit }) => {
      baseIs({ code });
      const args = { userId: USER_ID, errorKey: 'currencies.amountExceedsDecimals' };

      expect((await roundPositiveBaseAmount({ ...args, money: Money.fromDecimal(value) })).toString()).toBe(expected);
      await expect(roundPositiveBaseAmount({ ...args, money: Money.fromDecimal(belowUnit) })).rejects.toThrow(
        ValidationError,
      );
    },
  );

  it('rejects a user without a base currency', async () => {
    baseIs({ code: null });
    await expect(
      roundPositiveBaseAmount({ money: Money.fromDecimal('1.005'), userId: USER_ID, errorKey: 'x' }),
    ).rejects.toThrow(ValidationError);
  });
});
