import { describe, expect, it } from '@jest/globals';

import { Money, centsToApiDecimal, moneyToApiDecimal, moneyToApiDecimalOrNull } from './money';

describe('Money value object', () => {
  // ==========================================================================
  // Construction
  // ==========================================================================

  describe('fromCents', () => {
    it('creates Money from positive cents', () => {
      const m = Money.fromCents(1550);
      expect(m.toNumber()).toBe(15.5);
      expect(m.toCents()).toBe(1550);
    });

    it('creates Money from zero cents', () => {
      const m = Money.fromCents(0);
      expect(m.toNumber()).toBe(0);
      expect(m.toCents()).toBe(0);
    });

    it('creates Money from negative cents', () => {
      const m = Money.fromCents(-500);
      expect(m.toNumber()).toBe(-5);
      expect(m.toCents()).toBe(-500);
    });

    it('rejects NaN', () => {
      expect(() => Money.fromCents(NaN)).toThrow('expected finite number');
    });

    it('rejects Infinity', () => {
      expect(() => Money.fromCents(Infinity)).toThrow('expected finite number');
    });

    it('rejects -Infinity', () => {
      expect(() => Money.fromCents(-Infinity)).toThrow('expected finite number');
    });

    it('rejects non-integer', () => {
      expect(() => Money.fromCents(15.5)).toThrow('expected integer');
    });
  });

  describe('fromDecimal', () => {
    it('creates Money from a positive number', () => {
      const m = Money.fromDecimal(15.5);
      expect(m.toNumber()).toBe(15.5);
    });

    it('creates Money from zero', () => {
      const m = Money.fromDecimal(0);
      expect(m.isZero()).toBe(true);
    });

    it('creates Money from a negative number', () => {
      const m = Money.fromDecimal(-42.99);
      expect(m.toNumber()).toBe(-42.99);
    });

    it('creates Money from a string', () => {
      const m = Money.fromDecimal('102.5000000000');
      expect(m.toNumber()).toBe(102.5);
      expect(m.toDecimalString(10)).toBe('102.5000000000');
    });

    it('creates Money from a negative string', () => {
      const m = Money.fromDecimal('-7.25');
      expect(m.toNumber()).toBe(-7.25);
    });

    it('is idempotent when passed a Money instance', () => {
      const original = Money.fromDecimal(42.5);
      const copy = Money.fromDecimal(original);
      expect(copy.toNumber()).toBe(42.5);
      expect(copy).toBe(original); // same reference
    });

    it('rejects NaN', () => {
      expect(() => Money.fromDecimal(NaN)).toThrow('expected finite number');
    });

    it('rejects Infinity', () => {
      expect(() => Money.fromDecimal(Infinity)).toThrow('expected finite number');
    });

    it('rejects non-numeric string', () => {
      expect(() => Money.fromDecimal('abc')).toThrow('invalid value');
    });

    it('rejects empty string', () => {
      expect(() => Money.fromDecimal('')).toThrow('invalid value');
    });
  });

  describe('zero', () => {
    it('creates a zero Money', () => {
      const m = Money.zero();
      expect(m.isZero()).toBe(true);
      expect(m.toNumber()).toBe(0);
      expect(m.toCents()).toBe(0);
    });
  });

  describe('sum', () => {
    it('sums an array of Money values', () => {
      const values = [Money.fromDecimal(10), Money.fromDecimal(20.5), Money.fromDecimal(3.25)];
      const result = Money.sum(values);
      expect(result.toNumber()).toBe(33.75);
    });

    it('returns zero for empty array', () => {
      expect(Money.sum([]).isZero()).toBe(true);
    });

    it('handles mix of positive and negative', () => {
      const values = [Money.fromDecimal(100), Money.fromDecimal(-30), Money.fromDecimal(-20)];
      expect(Money.sum(values).toNumber()).toBe(50);
    });
  });

  // ==========================================================================
  // Arithmetic
  // ==========================================================================

  describe('arithmetic', () => {
    it('add', () => {
      const a = Money.fromDecimal(10.5);
      const b = Money.fromDecimal(3.25);
      expect(a.add(b).toNumber()).toBe(13.75);
    });

    it('subtract', () => {
      const a = Money.fromDecimal(10);
      const b = Money.fromDecimal(3.25);
      expect(a.subtract(b).toNumber()).toBe(6.75);
    });

    it('multiply by number', () => {
      const m = Money.fromDecimal(10);
      expect(m.multiply(3).toNumber()).toBe(30);
    });

    it('multiply by string factor', () => {
      const m = Money.fromDecimal(10);
      expect(m.multiply('0.5').toNumber()).toBe(5);
    });

    it('multiply by negative', () => {
      const m = Money.fromDecimal(10);
      expect(m.multiply(-1).toNumber()).toBe(-10);
    });

    it('divide by number', () => {
      const m = Money.fromDecimal(10);
      expect(m.divide(4).toNumber()).toBe(2.5);
    });

    it('divide by string', () => {
      const m = Money.fromDecimal(10);
      expect(m.divide('3').toDecimalString(4)).toBe('3.3333');
    });

    it('abs of positive', () => {
      expect(Money.fromDecimal(5).abs().toNumber()).toBe(5);
    });

    it('abs of negative', () => {
      expect(Money.fromDecimal(-5).abs().toNumber()).toBe(5);
    });

    it('negate positive', () => {
      expect(Money.fromDecimal(5).negate().toNumber()).toBe(-5);
    });

    it('negate negative', () => {
      expect(Money.fromDecimal(-5).negate().toNumber()).toBe(5);
    });

    it('negate zero', () => {
      expect(Money.zero().negate().isZero()).toBe(true);
    });

    it('round defaults to 2 decimal places', () => {
      const m = Money.fromDecimal(10.456);
      expect(m.round().toNumber()).toBe(10.46);
    });

    it('round to custom decimal places', () => {
      const m = Money.fromDecimal(10.123456);
      expect(m.round(4).toNumber()).toBe(10.1235);
    });

    it('round half up', () => {
      const m = Money.fromDecimal(10.125);
      expect(m.round().toNumber()).toBe(10.13);
    });

    it('roundHalfEven rounds a tie to the even neighbour', () => {
      expect(Money.fromDecimal('10.125').roundHalfEven().toNumber()).toBe(10.12);
      expect(Money.fromDecimal('10.135').roundHalfEven().toNumber()).toBe(10.14);
      expect(Money.fromDecimal('-10.125').roundHalfEven().toNumber()).toBe(-10.12);
    });

    it('roundHalfEven rounds a non-tie to the nearest value', () => {
      expect(Money.fromDecimal('10.1251').roundHalfEven().toNumber()).toBe(10.13);
      expect(Money.fromDecimal('2.5').roundHalfEven(0).toNumber()).toBe(2);
      expect(Money.fromDecimal('3.5').roundHalfEven(0).toNumber()).toBe(4);
    });
  });

  describe('immutability', () => {
    it('add does not mutate the original', () => {
      const a = Money.fromDecimal(10);
      const b = Money.fromDecimal(5);
      const result = a.add(b);
      expect(a.toNumber()).toBe(10);
      expect(result.toNumber()).toBe(15);
    });

    it('negate does not mutate the original', () => {
      const m = Money.fromDecimal(10);
      const negated = m.negate();
      expect(m.toNumber()).toBe(10);
      expect(negated.toNumber()).toBe(-10);
    });
  });

  // ==========================================================================
  // Comparison
  // ==========================================================================

  describe('comparison', () => {
    it('isZero', () => {
      expect(Money.zero().isZero()).toBe(true);
      expect(Money.fromDecimal(0.0).isZero()).toBe(true);
      expect(Money.fromDecimal(1).isZero()).toBe(false);
    });

    it('isPositive', () => {
      expect(Money.fromDecimal(1).isPositive()).toBe(true);
      expect(Money.zero().isPositive()).toBe(false);
      expect(Money.fromDecimal(-1).isPositive()).toBe(false);
    });

    it('isNegative', () => {
      expect(Money.fromDecimal(-1).isNegative()).toBe(true);
      expect(Money.zero().isNegative()).toBe(false);
      expect(Money.fromDecimal(1).isNegative()).toBe(false);
    });

    it('equals', () => {
      const a = Money.fromDecimal(10.5);
      const b = Money.fromDecimal(10.5);
      const c = Money.fromDecimal(10.6);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });

    it('equals: fromCents and fromDecimal represent same value', () => {
      const fromCents = Money.fromCents(1550);
      const fromDecimal = Money.fromDecimal(15.5);
      expect(fromCents.equals(fromDecimal)).toBe(true);
    });

    it('greaterThan', () => {
      expect(Money.fromDecimal(10).greaterThan(Money.fromDecimal(5))).toBe(true);
      expect(Money.fromDecimal(5).greaterThan(Money.fromDecimal(10))).toBe(false);
      expect(Money.fromDecimal(5).greaterThan(Money.fromDecimal(5))).toBe(false);
    });

    it('lessThan', () => {
      expect(Money.fromDecimal(5).lessThan(Money.fromDecimal(10))).toBe(true);
      expect(Money.fromDecimal(10).lessThan(Money.fromDecimal(5))).toBe(false);
      expect(Money.fromDecimal(5).lessThan(Money.fromDecimal(5))).toBe(false);
    });

    it('gte', () => {
      expect(Money.fromDecimal(10).gte(Money.fromDecimal(5))).toBe(true);
      expect(Money.fromDecimal(5).gte(Money.fromDecimal(5))).toBe(true);
      expect(Money.fromDecimal(4).gte(Money.fromDecimal(5))).toBe(false);
    });

    it('lte', () => {
      expect(Money.fromDecimal(5).lte(Money.fromDecimal(10))).toBe(true);
      expect(Money.fromDecimal(5).lte(Money.fromDecimal(5))).toBe(true);
      expect(Money.fromDecimal(6).lte(Money.fromDecimal(5))).toBe(false);
    });
  });

  // ==========================================================================
  // Output
  // ==========================================================================

  describe('output', () => {
    it('toCents converts to integer cents', () => {
      expect(Money.fromDecimal(15.5).toCents()).toBe(1550);
      expect(Money.fromDecimal(0.01).toCents()).toBe(1);
      expect(Money.fromDecimal(-10.99).toCents()).toBe(-1099);
    });

    it('toCents rounds correctly for floating point edge cases', () => {
      // 0.1 + 0.2 in floating point is 0.30000000000000004
      const m = Money.fromDecimal(0.1).add(Money.fromDecimal(0.2));
      expect(m.toCents()).toBe(30);
    });

    it('toDecimalString produces fixed-precision string', () => {
      expect(Money.fromDecimal(102.5).toDecimalString(10)).toBe('102.5000000000');
      expect(Money.fromDecimal(0).toDecimalString(2)).toBe('0.00');
      expect(Money.fromDecimal(-3.1159).toDecimalString(4)).toBe('-3.1159');
    });

    it('toNumber returns JS number', () => {
      expect(Money.fromDecimal(42.5).toNumber()).toBe(42.5);
    });

    it('toJSON returns JS number (for JSON.stringify)', () => {
      const m = Money.fromDecimal(15.5);
      expect(m.toJSON()).toBe(15.5);
      expect(JSON.stringify({ amount: m })).toBe('{"amount":15.5}');
    });

    it('toJSON works correctly in nested structures', () => {
      const obj = {
        items: [
          { amount: Money.fromDecimal(10.5), name: 'a' },
          { amount: Money.fromDecimal(20.75), name: 'b' },
        ],
      };
      const json = JSON.parse(JSON.stringify(obj));
      expect(json.items[0].amount).toBe(10.5);
      expect(json.items[1].amount).toBe(20.75);
    });

    it('toString returns string representation', () => {
      expect(Money.fromDecimal(42.5).toString()).toBe('42.5');
      expect(Money.fromDecimal(-3.14).toString()).toBe('-3.14');
    });
  });

  // ==========================================================================
  // Precision & edge cases
  // ==========================================================================

  describe('precision', () => {
    it('handles large investment quantities', () => {
      const m = Money.fromDecimal('12345678.123456789012345678');
      expect(m.toDecimalString(18)).toBe('12345678.123456789012345678');
    });

    it('preserves precision through arithmetic', () => {
      const price = Money.fromDecimal('150.50');
      const quantity = Money.fromDecimal('10.5');
      const total = price.multiply(quantity.toNumber());
      expect(total.toNumber()).toBe(1580.25);
    });

    it('round-trips through cents correctly', () => {
      const original = Money.fromDecimal(99.99);
      const cents = original.toCents();
      const restored = Money.fromCents(cents);
      expect(restored.equals(original)).toBe(true);
    });

    it('round-trips through decimal string correctly', () => {
      const original = Money.fromDecimal('102.5000000000');
      const str = original.toDecimalString(10);
      const restored = Money.fromDecimal(str);
      expect(restored.equals(original)).toBe(true);
    });
  });

  // ==========================================================================
  // Unified behavior: cents and decimal paths produce same Money
  // ==========================================================================

  describe('unification', () => {
    it('$15.50 from cents and from decimal are equal', () => {
      const fromCents = Money.fromCents(1550);
      const fromDecimal = Money.fromDecimal(15.5);
      expect(fromCents.equals(fromDecimal)).toBe(true);
      expect(fromCents.toCents()).toBe(fromDecimal.toCents());
      expect(fromCents.toNumber()).toBe(fromDecimal.toNumber());
    });

    it('arithmetic works across both creation paths', () => {
      const fromCents = Money.fromCents(1000); // $10.00
      const fromDecimal = Money.fromDecimal(5.5); // $5.50
      const result = fromCents.add(fromDecimal);
      expect(result.toNumber()).toBe(15.5);
      expect(result.toCents()).toBe(1550);
    });
  });
});

describe('API decimal helpers', () => {
  it('moneyToApiDecimal reads a Money and the exact string of a raw DECIMAL column alike', () => {
    expect(moneyToApiDecimal(Money.fromDecimal('25.5'))).toBe(25.5);
    expect(moneyToApiDecimal('25.500000000000000000')).toBe(25.5);
    expect(moneyToApiDecimal('-0.000406410000000000')).toBe(-0.00040641);
  });

  it('moneyToApiDecimalOrNull passes null and undefined through', () => {
    expect(moneyToApiDecimalOrNull(null)).toBeNull();
    expect(moneyToApiDecimalOrNull(undefined)).toBeNull();
    expect(moneyToApiDecimalOrNull('1.250000000000000000')).toBe(1.25);
  });

  it('centsToApiDecimal rejects a decimal string instead of misreading it as cents', () => {
    expect(() => centsToApiDecimal('25.500000000000000000' as unknown as number)).toThrow();
    expect(centsToApiDecimal(2550)).toBe(25.5);
  });
});
