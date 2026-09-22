import { describe, expect, it } from '@jest/globals';

import { clipRange, rangesIntersect } from './date-ranges';

describe('rangesIntersect', () => {
  it('treats the end as exclusive', () => {
    expect(
      rangesIntersect({ a: { from: '2026-01-01', until: '2026-02-01' }, b: { from: '2026-02-01', until: null } }),
    ).toBe(false);
    expect(
      rangesIntersect({ a: { from: '2026-01-01', until: '2026-03-01' }, b: { from: '2026-02-01', until: null } }),
    ).toBe(true);
  });

  it('is symmetric and handles two open ends', () => {
    const a = { from: '2026-01-01', until: null };
    const b = { from: '2026-05-01', until: null };

    expect(rangesIntersect({ a, b })).toBe(true);
    expect(rangesIntersect({ a: b, b: a })).toBe(true);
  });

  it('separates two closed ranges that only touch', () => {
    expect(
      rangesIntersect({
        a: { from: '2026-01-01', until: '2026-02-01' },
        b: { from: '2026-02-01', until: '2026-03-01' },
      }),
    ).toBe(false);
  });
});

describe('clipRange', () => {
  it('narrows both ends to the bounds', () => {
    expect(
      clipRange({
        range: { from: '2026-01-01', until: null },
        bounds: { from: '2026-02-01', until: '2026-04-01' },
      }),
    ).toEqual({ from: '2026-02-01', until: '2026-04-01' });
  });

  it('keeps the earlier of two closed ends', () => {
    expect(
      clipRange({
        range: { from: '2026-01-01', until: '2026-03-01' },
        bounds: { from: '2026-02-01', until: '2026-06-01' },
      }),
    ).toEqual({ from: '2026-02-01', until: '2026-03-01' });
  });

  it('keeps an open end when the bounds are open too', () => {
    expect(
      clipRange({ range: { from: '2026-03-01', until: null }, bounds: { from: '2026-01-01', until: null } }),
    ).toEqual({ from: '2026-03-01', until: null });
  });

  it('returns null when the bounds leave nothing', () => {
    expect(
      clipRange({ range: { from: '2026-05-01', until: null }, bounds: { from: '2026-01-01', until: '2026-05-01' } }),
    ).toBeNull();
    expect(
      clipRange({ range: { from: '2026-01-01', until: '2026-02-01' }, bounds: { from: '2026-03-01', until: null } }),
    ).toBeNull();
  });
});
