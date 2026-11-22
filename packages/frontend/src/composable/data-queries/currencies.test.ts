import { registerCurrencyDecimals, resetCurrencyDecimals } from '@/js/helpers/currency-decimals';

import { convertWithRates } from './currencies';

// Rates are units of the base currency per unit of the code.
const ratesMap = {
  USD: { rate: 1 },
  JPY: { rate: 0.0067 },
  KWD: { rate: 3.2537 },
  HUF: { rate: 0.0028 },
};

describe('convertWithRates', () => {
  afterEach(() => {
    resetCurrencyDecimals();
  });

  test('rounds to a whole number for a 0-decimal target', () => {
    // 100 / 0.0067 = 14925.37…
    expect(convertWithRates({ amount: 100, from: 'USD', to: 'JPY', ratesMap })).toBe(14925);
  });

  test('keeps three decimals for a 3-decimal target', () => {
    // 100 / 3.2537 = 30.73424…
    expect(convertWithRates({ amount: 100, from: 'USD', to: 'KWD', ratesMap })).toBe(30.734);
  });

  test('follows the registered decimals of the target', () => {
    registerCurrencyDecimals({ entries: [{ code: 'HUF', decimals: 2 }] });

    // 1 / 0.0028 = 357.142857…
    expect(convertWithRates({ amount: 1, from: 'USD', to: 'HUF', ratesMap })).toBe(357.14);
  });

  test('returns null, not zero, when a rate is missing', () => {
    expect(convertWithRates({ amount: 100, from: 'USD', to: 'GBP', ratesMap })).toBeNull();
    expect(convertWithRates({ amount: 100, from: 'GBP', to: 'USD', ratesMap })).toBeNull();
  });

  test('returns the amount unrounded when both codes match', () => {
    expect(convertWithRates({ amount: 1.23456, from: 'JPY', to: 'JPY', ratesMap })).toBe(1.23456);
  });
});
