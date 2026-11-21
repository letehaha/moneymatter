import { describe, expect, it, jest } from '@jest/globals';
import { ExchangeRateUnavailableError } from '@js/errors';

jest.mock('@js/utils/logger', () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

jest.mock('@models/users-currencies.model', () => ({
  __esModule: true,
  default: { findOne: () => Promise.resolve(null) },
  getBaseCurrency: jest.fn(),
}));

jest.mock('@services/currencies/custom-currency-codes', () => ({
  includesCustomCurrencyCode: () => Promise.resolve(false),
}));

const XOF_PER_USD = { value: 0 };
jest.mock('@services/exchange-rates/resolve-usd-rates', () => ({
  resolveUsdRates: ({ codes }: { codes: string[] }) =>
    Promise.resolve(
      new Map(
        codes.map((code) => [code, { kind: 'exact', rate: code === 'USD' ? 1 : XOF_PER_USD.value, date: new Date() }]),
      ),
    ),
}));

// eslint-disable-next-line import/first
import { getExchangeRate } from './get-exchange-rate.service';

const convert = ({ baseCode, quoteCode }: { baseCode: string; quoteCode: string }) =>
  getExchangeRate({
    userId: 1,
    date: new Date(),
    baseCode,
    quoteCode,
    bypassCache: true,
    requireUserConnection: false,
  });

describe('getExchangeRate', () => {
  it.each([
    { baseCode: 'USD', quoteCode: 'XOF' },
    { baseCode: 'XOF', quoteCode: 'USD' },
  ])('rejects a zero leg instead of returning 0 or Infinity: $baseCode -> $quoteCode', async (pair) => {
    XOF_PER_USD.value = 0;
    await expect(convert(pair)).rejects.toBeInstanceOf(ExchangeRateUnavailableError);
  });

  it('keeps a sub-0.00001 rate', async () => {
    XOF_PER_USD.value = 1_913_782.45;
    const { rate } = await convert({ baseCode: 'XOF', quoteCode: 'USD' });
    expect(rate * XOF_PER_USD.value).toBeCloseTo(1, 10);
  });
});
