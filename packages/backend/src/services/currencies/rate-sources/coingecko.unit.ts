import { describe, expect, it } from '@jest/globals';

import { isCoingeckoRateLimitError, toDailyRates } from './coingecko';

const at = (iso: string) => Date.parse(iso);

describe('toDailyRates', () => {
  it('gives one rate per UTC day, sorted', () => {
    expect(
      toDailyRates({
        points: [
          [at('2026-01-03T00:00:00Z'), 30],
          [at('2026-01-01T00:00:00Z'), 10],
          [at('2026-01-02T00:00:00Z'), 20],
        ],
      }),
    ).toEqual([
      { day: '2026-01-01', rate: 10 },
      { day: '2026-01-02', rate: 20 },
      { day: '2026-01-03', rate: 30 },
    ]);
  });

  it('takes the latest point of a day, which is the live price on the last day', () => {
    expect(
      toDailyRates({
        points: [
          [at('2026-01-02T00:00:00Z'), 20],
          [at('2026-01-02T09:30:00Z'), 22],
          [at('2026-01-01T00:00:00Z'), 10],
        ],
      }),
    ).toEqual([
      { day: '2026-01-01', rate: 10 },
      { day: '2026-01-02', rate: 22 },
    ]);
  });

  it('puts a point just before midnight UTC on the day it belongs to', () => {
    expect(toDailyRates({ points: [[at('2026-01-01T23:59:59Z'), 5]] })).toEqual([{ day: '2026-01-01', rate: 5 }]);
  });

  it('keeps the digits of a tiny price', () => {
    expect(toDailyRates({ points: [[at('2026-01-01T00:00:00Z'), 0.000000123456789]] })).toEqual([
      { day: '2026-01-01', rate: 0.000000123456789 },
    ]);
  });

  it('drops points without a positive finite price and malformed points', () => {
    expect(
      toDailyRates({
        points: [
          [at('2026-01-01T00:00:00Z'), null],
          [at('2026-01-02T00:00:00Z'), 0],
          [at('2026-01-03T00:00:00Z'), -4],
          [at('2026-01-04T00:00:00Z'), Number.NaN],
          [at('2026-01-05T00:00:00Z'), Number.POSITIVE_INFINITY],
          [Number.NaN, 7],
          [at('2026-01-06T00:00:00Z')],
          null,
          [at('2026-01-07T00:00:00Z'), 9],
        ],
      }),
    ).toEqual([{ day: '2026-01-07', rate: 9 }]);
  });

  it('answers an empty series for no points', () => {
    expect(toDailyRates({ points: [] })).toEqual([]);
  });
});

describe('isCoingeckoRateLimitError', () => {
  it('recognises a 429 from the SDK and nothing else', () => {
    expect(isCoingeckoRateLimitError(Object.assign(new Error('slow down'), { status: 429 }))).toBe(true);
    expect(isCoingeckoRateLimitError(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
    expect(isCoingeckoRateLimitError(new Error('429'))).toBe(false);
    expect(isCoingeckoRateLimitError(null)).toBe(false);
    expect(isCoingeckoRateLimitError('429')).toBe(false);
  });
});
