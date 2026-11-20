import { describe, expect, it } from 'vitest';

import {
  caretOffsetAfterDigits,
  countDigitsBeforeCaret,
  limitAmountDecimals,
  limitDecimalDigits,
  parseAmountInput,
} from './formatted-amount';

describe('parseAmountInput', () => {
  describe("decimalSeparator '.'", () => {
    it('parses a plain integer', () => {
      expect(parseAmountInput({ raw: '1234', decimalSeparator: '.' })).toEqual({
        numeric: 1234,
        fragment: '',
      });
    });

    it('strips group separators before parsing', () => {
      expect(parseAmountInput({ raw: '1,234.5', decimalSeparator: '.' })).toEqual({
        numeric: 1234.5,
        fragment: '',
      });
    });

    it('preserves a trailing decimal point as a fragment', () => {
      expect(parseAmountInput({ raw: '1234.', decimalSeparator: '.' })).toEqual({
        numeric: 1234,
        fragment: '.',
      });
    });

    it('preserves a trailing zero decimal as a fragment', () => {
      expect(parseAmountInput({ raw: '1234.50', decimalSeparator: '.' })).toEqual({
        numeric: 1234.5,
        fragment: '0',
      });
    });

    it('preserves all-zero decimals (including the dot) as a fragment', () => {
      expect(parseAmountInput({ raw: '2.00', decimalSeparator: '.' })).toEqual({
        numeric: 2,
        fragment: '.00',
      });
    });

    it('collapses extra decimal points after the first', () => {
      expect(parseAmountInput({ raw: '1.2.3', decimalSeparator: '.' })).toEqual({
        numeric: 1.23,
        fragment: '',
      });
    });

    it('caps decimals at 2 digits', () => {
      expect(parseAmountInput({ raw: '1.234', decimalSeparator: '.' })).toEqual({
        numeric: 1.23,
        fragment: '',
      });
    });

    it('returns null numeric for an empty string', () => {
      expect(parseAmountInput({ raw: '', decimalSeparator: '.' })).toEqual({
        numeric: null,
        fragment: '',
      });
    });

    it('returns null numeric for a lone decimal point', () => {
      expect(parseAmountInput({ raw: '.', decimalSeparator: '.' })).toEqual({
        numeric: null,
        fragment: '',
      });
    });
  });

  describe("decimalSeparator ','", () => {
    it('normalizes the locale separator before parsing', () => {
      expect(parseAmountInput({ raw: '1234,56', decimalSeparator: ',' })).toEqual({
        numeric: 1234.56,
        fragment: '',
      });
    });
  });

  describe('group separator conflicts with the canonical dot (de-DE, es-ES style)', () => {
    it('strips a "." group separator before normalizing a "," decimal (de-DE)', () => {
      expect(parseAmountInput({ raw: '1.234,56', decimalSeparator: ',', groupSeparator: '.' })).toEqual({
        numeric: 1234.56,
        fragment: '',
      });
    });

    it('handles multiple group separators ahead of the decimal', () => {
      expect(parseAmountInput({ raw: '1.234.567,89', decimalSeparator: ',', groupSeparator: '.' })).toEqual({
        numeric: 1234567.89,
        fragment: '',
      });
    });

    it('handles a grouped integer with no decimals yet', () => {
      expect(parseAmountInput({ raw: '1.234', decimalSeparator: ',', groupSeparator: '.' })).toEqual({
        numeric: 1234,
        fragment: '',
      });
    });

    it('progressive typing: appending a digit after the group separator grows the integer instead of adding a fraction', () => {
      // Field re-renders "1234" as "1.234" (de-DE thousands grouping) between
      // keystrokes; the next raw input event delivers "1.2345" verbatim.
      expect(parseAmountInput({ raw: '1.2345', decimalSeparator: ',', groupSeparator: '.' })).toEqual({
        numeric: 12345,
        fragment: '',
      });
    });

    it('parses a grouped integer followed by a typed decimal comma', () => {
      expect(parseAmountInput({ raw: '1.234,5', decimalSeparator: ',', groupSeparator: '.' })).toEqual({
        numeric: 1234.5,
        fragment: '',
      });
    });
  });

  describe('narrow/no-break-space group separator (fr-FR style)', () => {
    // The literal group-separator characters below are U+202F (narrow no-break
    // space) and U+00A0 (no-break space) — what Intl.NumberFormat('fr-FR', ...)
    // actually reports, not an ASCII space. They render identically to a
    // regular space in most editors.
    it('strips a narrow no-break space group separator', () => {
      expect(parseAmountInput({ raw: '1 234,56', decimalSeparator: ',', groupSeparator: ' ' })).toEqual({
        numeric: 1234.56,
        fragment: '',
      });
    });

    it('strips a plain no-break space group separator', () => {
      expect(parseAmountInput({ raw: '1 234,56', decimalSeparator: ',', groupSeparator: ' ' })).toEqual({
        numeric: 1234.56,
        fragment: '',
      });
    });

    it('progressive typing past the group boundary still grows the integer', () => {
      expect(parseAmountInput({ raw: '1 2345', decimalSeparator: ',', groupSeparator: ' ' })).toEqual({
        numeric: 12345,
        fragment: '',
      });
    });
  });

  describe('groupSeparator omitted (backward compatible default)', () => {
    it('still strips "," group separators via the general non-digit strip when no groupSeparator is passed', () => {
      expect(parseAmountInput({ raw: '1,234.5', decimalSeparator: '.' })).toEqual({
        numeric: 1234.5,
        fragment: '',
      });
    });
  });
});

describe('countDigitsBeforeCaret', () => {
  it('counts only digits, skipping group separators', () => {
    // "1,2|34" — caret after '2': '1' and '2' are anchors, ',' is not.
    expect(countDigitsBeforeCaret({ text: '1,234', caret: 3, decimalSeparator: '.' })).toBe(2);
  });

  it('counts the decimal point as an anchor', () => {
    // "1.|5" — caret after the dot: '1' and '.' both count.
    expect(countDigitsBeforeCaret({ text: '1.5', caret: 2, decimalSeparator: '.' })).toBe(2);
  });

  it('returns 0 when the caret is at the start', () => {
    expect(countDigitsBeforeCaret({ text: '1,234', caret: 0, decimalSeparator: '.' })).toBe(0);
  });
});

describe('caretOffsetAfterDigits', () => {
  it('lands right after the n-th anchor character', () => {
    // "12,345", 3 anchors consumed ('1','2', skip ',', '3') → index 3, caret goes to 4.
    expect(caretOffsetAfterDigits({ text: '12,345', digitCount: 3, decimalSeparator: '.' })).toBe(4);
  });

  it('returns 0 for a non-positive digit count', () => {
    expect(caretOffsetAfterDigits({ text: '12,345', digitCount: 0, decimalSeparator: '.' })).toBe(0);
  });

  it('clamps to the end when digit count exceeds available anchors', () => {
    expect(caretOffsetAfterDigits({ text: '12,345', digitCount: 99, decimalSeparator: '.' })).toBe(6);
  });
});

describe('parseAmountInput per-currency decimals', () => {
  it.each<[string, string, string | undefined, number | undefined, number | null, string]>([
    ['1.234', '.', undefined, 3, 1.234, ''],
    ['1.2345', '.', undefined, 3, 1.234, ''],
    ['1.230', '.', undefined, 3, 1.23, '0'],
    ['0.00040641', '.', undefined, 8, 0.00040641, ''],
    ['1500.6', '.', undefined, 0, 1500, ''],
    ['1500.', '.', undefined, 0, 1500, ''],
    ['.5', '.', undefined, 0, null, ''],
    ['20,500,000,000', '.', ',', 0, 20_500_000_000, ''],
    ['20.500.000.000', ',', '.', 0, 20_500_000_000, ''],
    ['1.239', '.', undefined, undefined, 1.23, ''],
  ])(
    '%s (decimal %s, group %s) at %s decimals → %s',
    (raw, decimalSeparator, groupSeparator, decimals, numeric, fragment) => {
      expect(parseAmountInput({ raw, decimalSeparator, groupSeparator, decimals })).toEqual({ numeric, fragment });
    },
  );
});

describe('limitDecimalDigits', () => {
  it.each<[string, number, string]>([
    ['1.23456', 3, '1.234'],
    ['1.2', 3, '1.2'],
    ['1500.6', 0, '1500'],
    ['1500.', 0, '1500'],
    ['1500', 0, '1500'],
    ['10.50', 2, '10.50'],
    ['', 2, ''],
  ])('%s at %d decimals → %s', (raw, decimals, expected) => {
    expect(limitDecimalDigits({ raw, decimals })).toBe(expected);
  });

  it('leaves exponent notation unchanged', () => {
    expect(limitDecimalDigits({ raw: '1.5e3', decimals: 0 })).toBe('1.5e3');
    expect(limitDecimalDigits({ raw: '1.23E-7', decimals: 2 })).toBe('1.23E-7');
  });
});

describe('limitAmountDecimals', () => {
  it.each<[number, number, number]>([
    [1000.555, 2, 1000.55],
    [1.005, 2, 1.0],
    [1.005, 3, 1.005],
    [10.5, 0, 10],
    [-10.59, 1, -10.5],
    [1500, 0, 1500],
    [1e-7, 8, 1e-7],
    [1.5e-7, 2, 0],
  ])('%d at %d decimals → %d', (value, decimals, expected) => {
    expect(limitAmountDecimals({ value, decimals })).toBe(expected);
  });
});
