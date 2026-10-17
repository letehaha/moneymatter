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
    expect(parseAmount('\u2212361,00')).toBe('-361');
    expect(parseAmount('\u2013361,00')).toBe('-361');
    expect(parseAmount('\u2014361,00')).toBe('-361');
    expect(parseAmount('\u2212 1,234.56')).toBe('-1234.56');
  });

  it.each([
    ['U+2010 hyphen', '\u2010'],
    ['U+2011 non-breaking hyphen', '\u2011'],
    ['U+2012 figure dash', '\u2012'],
    ['U+2013 en dash', '\u2013'],
    ['U+2014 em dash', '\u2014'],
    ['U+2015 horizontal bar', '\u2015'],
    ['U+2212 minus sign', '\u2212'],
    ['U+FE63 small hyphen-minus', '\uFE63'],
    ['U+FF0D fullwidth hyphen-minus', '\uFF0D'],
  ])('reads %s as a negative sign', (_name, dash) => {
    expect(parseAmount(`${dash}12.5`)).toBe('-12.5');
  });

  it('does not read the characters just outside the dash range as a sign', () => {
    expect(parseAmount('\u200F12.5')).toBeNull();
    expect(parseAmount('\u201612.5')).toBeNull();
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

  it('keeps exponents within the bound and reads them exactly', () => {
    expect(parseAmount('1e-3')).toBe('0.001');
    expect(parseAmount('1.5E+2')).toBe('150');
    expect(parseAmount('1e30')).toBe(`1${'0'.repeat(30)}`);
  });

  it('rejects an exponent beyond the bound instead of expanding it', () => {
    const startedAt = performance.now();

    expect(parseAmount('1e31')).toBeNull();
    expect(parseAmount('1e-31')).toBeNull();
    expect(parseAmount('1e9999999')).toBeNull();
    expect(parseAmount('-1e300000000')).toBeNull();
    expect(parseAmount('(1e-1000000000)')).toBeNull();
    expect(parseAmount(`1e${'9'.repeat(5000)}`)).toBeNull();
    expect(parseAmount('0e999999999')).toBeNull();

    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});
