import { describe, expect, it } from '@jest/globals';

import { parseDecimalAmount } from './parse-decimal-amount';

describe('parseDecimalAmount', () => {
  it.each([
    ['a bare integer', '250', 250],
    ['a bare decimal', '1234.56', 1234.56],
    ['one decimal place', '1234.5', 1234.5],
    ['a leading decimal point', '.99', 0.99],
    ['more precision than money needs', '0.123456', 0.123456],
  ])('reads %s', (_label, raw, expected) => {
    expect(parseDecimalAmount({ raw })).toBe(expected);
  });

  describe('thousands separators', () => {
    it.each([
      ['US grouping', '1,234.56', 1234.56],
      ['European grouping', '1.234,56', 1234.56],
      ['space grouping with a decimal comma', '1 234,56', 1234.56],
      ['space grouping with a decimal point', '1 234.56', 1234.56],
      ['a non-breaking space', '1 234,56', 1234.56],
      ['the Swiss apostrophe', "1'234.56", 1234.56],
      ['several US groups', '1,234,567.89', 1234567.89],
      ['several European groups', '1.234.567,89', 1234567.89],
    ])('reads %s', (_label, raw, expected) => {
      expect(parseDecimalAmount({ raw })).toBe(expected);
    });

    it('reads a grouped amount that has no decimal part', () => {
      expect(parseDecimalAmount({ raw: '1,234,567' })).toBe(1234567);
      expect(parseDecimalAmount({ raw: '1.234.567' })).toBe(1234567);
    });
  });

  describe('a lone separator', () => {
    // Two decimal places cannot be a thousands group, so the mark is the decimal point.
    it.each([
      ['a decimal comma', '1234,56', 1234.56],
      ['a decimal comma on a small amount', '9,99', 9.99],
      ['four decimals', '1,2345', 1.2345],
    ])('reads %s', (_label, raw, expected) => {
      expect(parseDecimalAmount({ raw })).toBe(expected);
    });

    // Guessing here would be wrong by 1000x, which is worse than skipping the row.
    it.each([
      ['a comma before three digits', '1,234'],
      ['a dot before three digits', '1.234'],
    ])('refuses %s as genuinely ambiguous', (_label, raw) => {
      expect(parseDecimalAmount({ raw })).toBeNull();
    });

    it('reads three decimals when nothing precedes the separator', () => {
      expect(parseDecimalAmount({ raw: '.234' })).toBe(0.234);
    });
  });

  describe('text that is not an amount', () => {
    it.each([
      ['a currency symbol', '$250.50'],
      ['a trailing unit', '250.50 UYU'],
      ['a leading code', 'UYU 250.50'],
      ['scientific notation', '1e3'],
      ['a negative sign', '-5'],
      ['a plus sign', '+5'],
      ['letters', 'abc'],
      ['nothing', ''],
      ['only whitespace', '   '],
      ['only separators', '.,'],
      ['a malformed group', '1.2.3'],
      ['an empty first group', ',250,000'],
      ['a first group over three digits', '1234,567.89'],
    ])('refuses %s', (_label, raw) => {
      expect(parseDecimalAmount({ raw })).toBeNull();
    });
  });
});
