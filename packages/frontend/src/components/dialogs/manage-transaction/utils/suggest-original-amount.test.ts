import { describe, expect, it } from 'vitest';

import { canSuggestOriginalAmount, resolveSuggestedOriginalAmount } from './suggest-original-amount';

type SuggestionArgs = Parameters<typeof canSuggestOriginalAmount>[0];

describe('canSuggestOriginalAmount', () => {
  const buildArgs = (overrides: Partial<SuggestionArgs> = {}): SuggestionArgs => ({
    amount: 100,
    accountCurrencyCode: 'USD',
    originalCurrencyCode: 'JPY',
    originalAmount: null,
    ...overrides,
  });

  const cases: [string, Partial<SuggestionArgs>, boolean][] = [
    ['a complete form with an empty original amount', {}, true],
    ['a filled original amount', { originalAmount: 5000 }, false],
    ['a zero original amount', { originalAmount: 0 }, false],
    ['no original currency', { originalCurrencyCode: null }, false],
    ['no account currency', { accountCurrencyCode: undefined }, false],
    ['no main amount', { amount: null }, false],
    ['a blank main amount', { amount: '' }, false],
    ['a non-numeric main amount', { amount: 'abc' }, false],
  ];

  it.each(cases)('is %s -> %s', (_label, overrides, expected) => {
    expect(canSuggestOriginalAmount(buildArgs(overrides))).toBe(expected);
  });
});

describe('resolveSuggestedOriginalAmount', () => {
  it('rounds to a 0-digit currency', () => {
    expect(resolveSuggestedOriginalAmount({ amount: 10, rate: 123.456, currencyDigits: 0 })).toBe(1235);
  });

  it('rounds to a 2-digit currency', () => {
    expect(resolveSuggestedOriginalAmount({ amount: 10, rate: 0.91234, currencyDigits: 2 })).toBe(9.12);
  });

  it('keeps all three decimals of a 3-digit currency', () => {
    expect(resolveSuggestedOriginalAmount({ amount: 10, rate: 0.376543, currencyDigits: 3 })).toBe(3.765);
  });

  it('keeps the decimals of a high-precision currency', () => {
    expect(resolveSuggestedOriginalAmount({ amount: 10, rate: 0.000123456789, currencyDigits: 8 })).toBe(0.00123457);
  });

  it('falls back to two decimals when the currency carries no digits', () => {
    expect(resolveSuggestedOriginalAmount({ amount: 10, rate: 0.91234, currencyDigits: undefined })).toBe(9.12);
  });

  it.each([
    ['missing', undefined],
    ['null', null],
    ['NaN', NaN],
    ['Infinity', Infinity],
  ])('returns null for a %s rate', (_label, rate) => {
    expect(resolveSuggestedOriginalAmount({ amount: 10, rate, currencyDigits: 2 })).toBeNull();
  });
});
