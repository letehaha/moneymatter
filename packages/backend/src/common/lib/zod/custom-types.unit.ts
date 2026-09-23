import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import { dateBound, dateRange, withDateOrder } from './custom-types';

describe('dateBound', () => {
  describe("precision 'date' (default)", () => {
    const schema = dateBound();

    it('accepts a real calendar day', () => {
      expect(schema.safeParse('2025-01-15').success).toBe(true);
    });

    it('rejects a regex-matching but non-existent date', () => {
      expect(schema.safeParse('2025-13-45').success).toBe(false);
    });

    it('rejects a day that would roll over into the next month', () => {
      expect(schema.safeParse('2026-02-30').success).toBe(false);
      expect(schema.safeParse('2026-02-28').success).toBe(true);
    });

    it('rejects a full ISO datetime', () => {
      expect(schema.safeParse('2025-01-15T00:00:00.000Z').success).toBe(false);
    });

    it('rejects freeform garbage', () => {
      expect(schema.safeParse('not-a-date').success).toBe(false);
    });
  });

  describe("precision 'datetime'", () => {
    const schema = dateBound({ precision: 'datetime' });

    it('accepts a UTC ISO datetime', () => {
      expect(schema.safeParse('2025-01-15T12:30:00.000Z').success).toBe(true);
    });

    it('rejects a date-only string', () => {
      expect(schema.safeParse('2025-01-15').success).toBe(false);
    });

    it('rejects a datetime with a timezone offset when offset is not allowed', () => {
      expect(schema.safeParse('2025-01-15T12:30:00+05:00').success).toBe(false);
    });
  });

  describe("precision 'datetime' with offset", () => {
    const schema = dateBound({ precision: 'datetime', offset: true });

    it('accepts a datetime with a timezone offset', () => {
      expect(schema.safeParse('2025-01-15T12:30:00+05:00').success).toBe(true);
    });

    it('still accepts a UTC datetime', () => {
      expect(schema.safeParse('2025-01-15T12:30:00Z').success).toBe(true);
    });
  });
});

describe('dateRange (spreadable { from, to } fields)', () => {
  describe('optional bounds (default) + withDateOrder', () => {
    const schema = withDateOrder(z.object({ ...dateRange(), accountId: z.string().optional() }));

    it('accepts an empty object (both bounds absent)', () => {
      expect(schema.safeParse({}).success).toBe(true);
    });

    it('accepts only one bound', () => {
      expect(schema.safeParse({ from: '2025-01-01' }).success).toBe(true);
      expect(schema.safeParse({ to: '2025-01-31' }).success).toBe(true);
    });

    it('accepts a well-ordered range and passes sibling fields through', () => {
      const result = schema.safeParse({ from: '2025-01-01', to: '2025-01-31', accountId: 'acc-1' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.accountId).toBe('acc-1');
      }
    });

    it('accepts an equal range', () => {
      expect(schema.safeParse({ from: '2025-01-15', to: '2025-01-15' }).success).toBe(true);
    });

    it('rejects an inverted range', () => {
      const result = schema.safeParse({ from: '2025-01-31', to: '2025-01-01' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(['from']);
      }
    });

    it('rejects a malformed bound', () => {
      expect(schema.safeParse({ from: 'garbage' }).success).toBe(false);
    });
  });

  describe('required bounds', () => {
    const schema = withDateOrder(z.object({ ...dateRange({ required: true }) }));

    it('rejects when a bound is missing', () => {
      expect(schema.safeParse({ from: '2025-01-01' }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(false);
    });

    it('accepts when both bounds are present and ordered', () => {
      expect(schema.safeParse({ from: '2025-01-01', to: '2025-01-31' }).success).toBe(true);
    });

    it('produces a string-typed from at the type level', () => {
      const parsed = z.object({ ...dateRange({ required: true }) }).parse({ from: '2025-01-01', to: '2025-01-31' });
      // Compile-time assertion: `from` is a required string on the required variant.
      const from: string = parsed.from;
      expect(from).toBe('2025-01-01');
    });
  });

  describe('datetime precision', () => {
    const schema = withDateOrder(z.object({ ...dateRange({ precision: 'datetime' }) }));

    it('orders by instant, not lexicographically', () => {
      expect(schema.safeParse({ from: '2025-01-01T00:00:00Z', to: '2025-01-01T12:00:00Z' }).success).toBe(true);
      expect(schema.safeParse({ from: '2025-01-01T12:00:00Z', to: '2025-01-01T00:00:00Z' }).success).toBe(false);
    });
  });

  describe('datetime precision with offset', () => {
    const schema = withDateOrder(z.object({ ...dateRange({ required: true, precision: 'datetime', offset: true }) }));

    it('compares offset datetimes as absolute instants', () => {
      // 2025-01-01T10:00:00+05:00 == 05:00Z, which is before 06:00Z — ordered.
      expect(schema.safeParse({ from: '2025-01-01T10:00:00+05:00', to: '2025-01-01T06:00:00Z' }).success).toBe(true);
      // 2025-01-01T10:00:00+05:00 == 05:00Z, which is after 04:00Z — inverted.
      expect(schema.safeParse({ from: '2025-01-01T10:00:00+05:00', to: '2025-01-01T04:00:00Z' }).success).toBe(false);
    });
  });
});

describe('withDateOrder', () => {
  describe('guards against a no-op (missing bound fields)', () => {
    it('throws when the object has neither bound field', () => {
      expect(() => withDateOrder(z.object({ foo: z.string() }))).toThrow(/missing bound field/i);
    });

    it('throws when one bound field is missing', () => {
      expect(() => withDateOrder(z.object({ from: dateBound() }))).toThrow(/\bto\b/);
    });

    it('throws when applied to a non-object schema', () => {
      expect(() => withDateOrder(z.string() as never)).toThrow(/not a ZodObject/);
    });

    it('does not throw when the fields come from a spread dateRange()', () => {
      expect(() => withDateOrder(z.object({ ...dateRange(), accountId: z.string() }))).not.toThrow();
    });

    it('does not throw for custom-named bound fields present in the object', () => {
      expect(() =>
        withDateOrder(z.object({ startDate: dateBound(), endDate: dateBound().nullable().optional() }), [
          'startDate',
          'endDate',
        ]),
      ).not.toThrow();
    });

    it('reads the shape through a superRefine wrapper (still throws when fields are absent)', () => {
      expect(() =>
        withDateOrder(
          z.object({ foo: z.string() }).superRefine(() => {}),
          ['startDate', 'endDate'],
        ),
      ).toThrow(/missing bound field/i);
    });
  });

  it('attaches the ordering guard to a manually built schema with custom names', () => {
    const schema = withDateOrder(z.object({ dateFrom: dateBound(), dateTo: dateBound() }), ['dateFrom', 'dateTo']);
    expect(schema.safeParse({ dateFrom: '2025-01-01', dateTo: '2025-01-31' }).success).toBe(true);

    const inverted = schema.safeParse({ dateFrom: '2025-02-01', dateTo: '2025-01-01' });
    expect(inverted.success).toBe(false);
    if (!inverted.success) {
      expect(inverted.error.issues[0]?.path).toEqual(['dateFrom']);
    }
  });

  // The pattern domain entities (budget, subscription) use: their own asymmetric /
  // nullable bound optionality via `dateBound`, plus the shared ordering guard.
  describe('nullable / asymmetric domain-entity bounds', () => {
    const schema = withDateOrder(
      z.object({
        startDate: dateBound(),
        endDate: dateBound().nullable().optional(),
      }),
      ['startDate', 'endDate'],
    );

    it('accepts a null upper bound', () => {
      expect(schema.safeParse({ startDate: '2025-01-01', endDate: null }).success).toBe(true);
    });

    it('accepts an absent upper bound', () => {
      expect(schema.safeParse({ startDate: '2025-01-01' }).success).toBe(true);
    });

    it('still enforces ordering when both bounds are present', () => {
      expect(schema.safeParse({ startDate: '2025-02-01', endDate: '2025-01-01' }).success).toBe(false);
    });
  });
});
