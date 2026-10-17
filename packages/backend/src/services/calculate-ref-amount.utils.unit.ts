import { Money } from '@common/types/money';
import { describe, expect, it } from '@jest/globals';

import { calculateRefAmountFromParams } from './calculate-ref-amount.utils';

const TWO_DECIMALS = { baseDecimals: 2, quoteDecimals: 2 };

describe('calculateRefAmountFromParams', () => {
  describe('useFloorAbs=true (default - regular transactions)', () => {
    it("rounds fractional cent results to nearest integer using banker's rounding", () => {
      // 205 cents * 0.5 = 102.5 → rounds to 102 (banker's rounding to even)
      const result = calculateRefAmountFromParams({
        ...TWO_DECIMALS,
        amount: Money.fromCents(205),
        rate: 0.5,
      });
      expect(result.toCents()).toBe(102);
    });

    it('returns zero for zero amount', () => {
      const result = calculateRefAmountFromParams({
        ...TWO_DECIMALS,
        amount: Money.zero(),
        rate: 1.5,
      });
      expect(result.toCents()).toBe(0);
    });

    it.each([
      // 0.05 * 0.5 = 0.025 and 0.15 * 0.5 = 0.075 are exact ties: the even neighbour wins
      ['0.05', 0.5, '0.02'],
      ['0.15', 0.5, '0.08'],
      ['-0.05', 0.5, '-0.02'],
      ['-0.15', 0.5, '-0.08'],
    ])('rounds the exact tie %s * %s to the even cent %s', (amount, rate, expected) => {
      const result = calculateRefAmountFromParams({ amount: Money.fromDecimal(amount), rate, ...TWO_DECIMALS });
      expect(result.toDecimalString(2)).toBe(expected);
    });

    it('keeps the exact product of large amounts and small rates', () => {
      // 123456789012.34 * 0.0000123 = 1518518.504851782: float arithmetic on cents would drift here
      const result = calculateRefAmountFromParams({
        amount: Money.fromDecimal('123456789012.34'),
        rate: 0.0000123,
        ...TWO_DECIMALS,
      });
      expect(result.toDecimalString(2)).toBe('1518518.50');
    });

    it('preserves sign for negative amounts', () => {
      // -200 cents * 1.5 = -300 cents
      const result = calculateRefAmountFromParams({
        ...TWO_DECIMALS,
        amount: Money.fromCents(-200),
        rate: 1.5,
      });
      expect(result.toCents()).toBe(-300);
    });
  });

  describe('useFloorAbs=false (investments - DECIMAL precision)', () => {
    it('does not throw when amount * rate produces a fractional cent', () => {
      // 205 cents * 0.5 = 102.5 (fractional) — must not throw
      expect(() =>
        calculateRefAmountFromParams({
          ...TWO_DECIMALS,
          amount: Money.fromCents(205),
          rate: 0.5,
          useFloorAbs: false,
        }),
      ).not.toThrow();
    });

    it('preserves decimal precision instead of rounding to whole cents', () => {
      // 205 cents (= $2.05) * 0.5 = $1.025 — should keep the half-cent precision
      const result = calculateRefAmountFromParams({
        ...TWO_DECIMALS,
        amount: Money.fromCents(205),
        rate: 0.5,
        useFloorAbs: false,
      });
      expect(result.toNumber()).toBe(1.025);
    });

    it('preserves sign for negative amounts with fractional results', () => {
      const result = calculateRefAmountFromParams({
        ...TWO_DECIMALS,
        amount: Money.fromCents(-205),
        rate: 0.5,
        useFloorAbs: false,
      });
      expect(result.toNumber()).toBe(-1.025);
    });

    it('returns zero for zero amount', () => {
      const result = calculateRefAmountFromParams({
        ...TWO_DECIMALS,
        amount: Money.zero(),
        rate: 1.5,
        useFloorAbs: false,
      });
      expect(result.toNumber()).toBe(0);
    });
  });
  describe('currency decimals', () => {
    it('rounds the product half-even to the decimals of the target currency', () => {
      // 5 JPY * 0.0005 = 0.0025 KWD and 15 JPY * 0.0005 = 0.0075 KWD are exact ties
      const convert = (amount: string) =>
        calculateRefAmountFromParams({
          amount: Money.fromDecimal(amount),
          rate: 0.0005,
          baseDecimals: 0,
          quoteDecimals: 3,
        }).toDecimalString(3);

      expect(convert('5')).toBe('0.002');
      expect(convert('15')).toBe('0.008');
    });

    it('rounds a target currency without decimals to whole units', () => {
      const result = calculateRefAmountFromParams({
        amount: Money.fromDecimal('10.50'),
        rate: 149.255,
        baseDecimals: 2,
        quoteDecimals: 0,
      });

      expect(result.toDecimalString(0)).toBe('1567');
      expect(result.toNumber()).toBe(1567);
    });

    it('rounds the amount to its own currency decimals before converting', () => {
      // 1.0005 KWD rounds to 1.001 KWD first; 1.001 * 100 = 100.1 JPY -> 100
      const result = calculateRefAmountFromParams({
        amount: Money.fromDecimal('1.0005'),
        rate: 100,
        baseDecimals: 3,
        quoteDecimals: 0,
      });

      expect(result.toNumber()).toBe(100);
    });

    it('keeps the 8 decimals of a crypto target currency', () => {
      const result = calculateRefAmountFromParams({
        amount: Money.fromDecimal('250'),
        rate: 0.0000162564,
        baseDecimals: 2,
        quoteDecimals: 8,
      });

      expect(result.toDecimalString(8)).toBe('0.00406410');
    });
  });
});
