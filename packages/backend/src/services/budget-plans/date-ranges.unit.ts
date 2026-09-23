import { describe, expect, it } from '@jest/globals';

import { clipRange, rangesIntersect, subtractRanges } from './date-ranges';

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

  it('returns null for empty bounds', () => {
    expect(
      clipRange({ range: { from: '2026-01-01', until: null }, bounds: { from: '2026-03-01', until: '2026-03-01' } }),
    ).toBeNull();
  });
});

describe('subtractRanges', () => {
  it('leaves two parts when a cut sits in the middle', () => {
    expect(
      subtractRanges({
        range: { from: '2026-01-01', until: null },
        cuts: [{ from: '2026-03-01', until: '2026-05-01' }],
      }),
    ).toEqual([
      { from: '2026-01-01', until: '2026-03-01' },
      { from: '2026-05-01', until: null },
    ]);
  });

  it('leaves nothing when the cuts cover the whole range', () => {
    expect(
      subtractRanges({
        range: { from: '2026-01-01', until: '2026-06-01' },
        cuts: [
          { from: '2026-03-01', until: null },
          { from: '2025-12-01', until: '2026-03-01' },
        ],
      }),
    ).toEqual([]);
  });

  it('keeps the range when no cut overlaps it', () => {
    const range = { from: '2026-01-01', until: '2026-03-01' };

    expect(
      subtractRanges({
        range,
        cuts: [
          { from: '2025-06-01', until: '2026-01-01' },
          { from: '2026-03-01', until: null },
        ],
      }),
    ).toEqual([range]);
  });
});
