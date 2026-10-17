import { describe, expect, it } from '@jest/globals';

import { parseAmount } from './parse-amount';

describe('parseAmount (core tabular-import amount parser)', () => {
  it('returns null for empty or blank input', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('--')).toBeNull();
  });

  it('parses plain decimals into exact decimal strings', () => {
    expect(parseAmount('1234.56')).toBe('1234.56');
    expect(parseAmount('1234')).toBe('1234');
    expect(parseAmount('0.5')).toBe('0.5');
  });

  it('keeps every digit the source wrote, whatever the currency decimals are', () => {
    expect(parseAmount('0.12345678')).toBe('0.12345678');
    expect(parseAmount('1.234')).toBe('1.234');
    expect(parseAmount('1.234,5678')).toBe('1234.5678');
    expect(parseAmount('(12.345)')).toBe('-12.345');
    expect(parseAmount('10.996')).toBe('10.996');
  });

  it('strips US/UK thousands separators', () => {
    expect(parseAmount('1,234.56')).toBe('1234.56');
    expect(parseAmount('1,000,000.00')).toBe('1000000');
  });

  it('parses European format (period thousands, comma decimal)', () => {
    expect(parseAmount('1.234,56')).toBe('1234.56');
    expect(parseAmount('1.000.000,00')).toBe('1000000');
  });

  it('treats a lone comma as the decimal separator', () => {
    // With no period present, the comma is read as the decimal point (European
    // convention), not a thousands separator: '1,5' -> 1.5, '1,234' -> 1.234.
    expect(parseAmount('1,5')).toBe('1.5');
    expect(parseAmount('1,234')).toBe('1.234');
  });

  it('treats parentheses as a negative (accounting format)', () => {
    expect(parseAmount('(1234.56)')).toBe('-1234.56');
    expect(parseAmount('(100)')).toBe('-100');
  });

  it('honors explicit signs', () => {
    expect(parseAmount('-1234.56')).toBe('-1234.56');
    expect(parseAmount('+500')).toBe('500');
  });

  it('treats Unicode minus and dash variants as a negative sign', () => {
    expect(parseAmount('−361,00')).toBe('-361');
    expect(parseAmount('–361,00')).toBe('-361');
    expect(parseAmount('—361,00')).toBe('-361');
    expect(parseAmount('‐361,00')).toBe('-361');
    expect(parseAmount('− 1,234.56')).toBe('-1234.56');
  });

  it('strips currency symbols and whitespace', () => {
    expect(parseAmount('$1,000.00')).toBe('1000');
    expect(parseAmount('€1.000,50')).toBe('1000.5');
    expect(parseAmount('£10.00')).toBe('10');
    expect(parseAmount('¥1000')).toBe('1000');
    expect(parseAmount('₴ 250.00')).toBe('250');
    expect(parseAmount('₽5')).toBe('5');
    expect(parseAmount('  100.00  ')).toBe('100');
  });

  it('returns a plain zero for a negative zero', () => {
    expect(parseAmount('-0')).toBe('0');
    expect(parseAmount('(0.00)')).toBe('0');
  });

  it('never returns exponent notation', () => {
    expect(parseAmount('0.00000001')).toBe('0.00000001');
    expect(parseAmount('1e3')).toBe('1000');
  });
});
