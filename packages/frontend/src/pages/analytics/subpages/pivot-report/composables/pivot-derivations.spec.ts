import type { PivotRow, SavedPivotViewConfig } from '@bt/shared/types';
import { describe, expect, it } from 'vitest';

import {
  HEATMAP_ALPHA_RANGE,
  HEATMAP_MIN_ALPHA,
  TOTAL_COLUMN_KEY,
  arePivotConfigsEqual,
  computeAllCollapsed,
  computeColumnMax,
  computeDelta,
  computeVisibleRows,
  findMatchingViewId,
  getRowValue,
  heatmapAlpha,
  isDeltaGood,
  sortPivotRows,
} from './pivot-derivations';

const makeRow = (over: Partial<PivotRow> & { id: string }): PivotRow => ({
  label: over.id,
  color: null,
  parentId: null,
  kind: 'flat',
  values: {},
  total: 0,
  ...over,
});

describe('getRowValue', () => {
  it('reads a column key from values, defaulting missing buckets to 0', () => {
    const row = makeRow({ id: 'a', values: { '2024': 10 }, total: 10 });
    expect(getRowValue({ row, columnKey: '2024' })).toBe(10);
    expect(getRowValue({ row, columnKey: '2025' })).toBe(0);
  });

  it('reads the synthetic total column from row.total', () => {
    const row = makeRow({ id: 'a', total: 42 });
    expect(getRowValue({ row, columnKey: TOTAL_COLUMN_KEY })).toBe(42);
  });
});

describe('computeColumnMax', () => {
  it('takes the largest absolute value among top-level rows', () => {
    const rows = [makeRow({ id: 'a', values: { c: 30 } }), makeRow({ id: 'b', values: { c: -50 } })];
    expect(computeColumnMax({ rows, columnKey: 'c' })).toBe(50);
  });

  it('excludes child rows so a child cannot out-shade its parent', () => {
    const rows = [
      makeRow({ id: 'p', kind: 'parent', values: { c: 20 } }),
      makeRow({ id: 'ch', kind: 'child', parentId: 'p', values: { c: 999 } }),
    ];
    expect(computeColumnMax({ rows, columnKey: 'c' })).toBe(20);
  });
});

describe('heatmapAlpha', () => {
  it('returns 0 for empty cells and empty columns', () => {
    expect(heatmapAlpha({ value: 0, columnMax: 100 })).toBe(0);
    expect(heatmapAlpha({ value: 50, columnMax: 0 })).toBe(0);
  });

  it('scales the max cell to the top of the range', () => {
    expect(heatmapAlpha({ value: 100, columnMax: 100 })).toBeCloseTo(HEATMAP_MIN_ALPHA + HEATMAP_ALPHA_RANGE);
  });

  it('floors intensity at the minimum alpha for tiny non-zero cells', () => {
    const alpha = heatmapAlpha({ value: 1, columnMax: 1_000_000 });
    expect(alpha).toBeGreaterThanOrEqual(HEATMAP_MIN_ALPHA);
  });
});

describe('computeDelta', () => {
  it('returns null when there is no previous value', () => {
    expect(computeDelta({ current: 10, previous: undefined })).toBeNull();
  });

  it('returns null when the previous magnitude is 0', () => {
    expect(computeDelta({ current: 10, previous: 0 })).toBeNull();
  });

  it('computes a magnitude ratio regardless of sign', () => {
    expect(computeDelta({ current: 150, previous: 100 })).toBeCloseTo(0.5);
    expect(computeDelta({ current: -50, previous: -100 })).toBeCloseTo(-0.5);
  });
});

describe('isDeltaGood', () => {
  it('treats shrinking expenses as good and growing as bad', () => {
    expect(isDeltaGood({ delta: -0.2, measure: 'expense' })).toBe(true);
    expect(isDeltaGood({ delta: 0.2, measure: 'expense' })).toBe(false);
  });

  it('treats growing income as good and shrinking as bad', () => {
    expect(isDeltaGood({ delta: 0.2, measure: 'income' })).toBe(true);
    expect(isDeltaGood({ delta: -0.2, measure: 'income' })).toBe(false);
  });

  it('is never good for a flat delta', () => {
    expect(isDeltaGood({ delta: 0, measure: 'expense' })).toBe(false);
    expect(isDeltaGood({ delta: 0, measure: 'income' })).toBe(false);
  });
});

describe('sortPivotRows', () => {
  it('sorts top-level rows by magnitude descending', () => {
    const rows = [makeRow({ id: 'a', total: 10 }), makeRow({ id: 'b', total: 30 }), makeRow({ id: 'c', total: 20 })];
    const sorted = sortPivotRows({ rows, columnKey: TOTAL_COLUMN_KEY, direction: 'desc' });
    expect(sorted.map((r) => r.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts top-level rows by magnitude ascending', () => {
    const rows = [makeRow({ id: 'a', total: 10 }), makeRow({ id: 'b', total: 30 }), makeRow({ id: 'c', total: 20 })];
    const sorted = sortPivotRows({ rows, columnKey: TOTAL_COLUMN_KEY, direction: 'asc' });
    expect(sorted.map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('keeps children grouped under their sorted parent', () => {
    const rows = [
      makeRow({ id: 'p1', kind: 'parent', total: 10 }),
      makeRow({ id: 'p1-c1', kind: 'child', parentId: 'p1', total: 3 }),
      makeRow({ id: 'p1-c2', kind: 'child', parentId: 'p1', total: 7 }),
      makeRow({ id: 'p2', kind: 'parent', total: 40 }),
      makeRow({ id: 'p2-c1', kind: 'child', parentId: 'p2', total: 40 }),
    ];
    const sorted = sortPivotRows({ rows, columnKey: TOTAL_COLUMN_KEY, direction: 'desc' });
    expect(sorted.map((r) => r.id)).toEqual(['p2', 'p2-c1', 'p1', 'p1-c2', 'p1-c1']);
  });
});

describe('computeVisibleRows', () => {
  const rows = [
    makeRow({ id: 'p1', kind: 'parent' }),
    makeRow({ id: 'p1-c1', kind: 'child', parentId: 'p1' }),
    makeRow({ id: 'p1-c2', kind: 'child', parentId: 'p1' }),
    makeRow({ id: 'p2', kind: 'parent' }),
    makeRow({ id: 'p2-c1', kind: 'child', parentId: 'p2' }),
  ];

  it('shows every row when nothing is collapsed', () => {
    expect(computeVisibleRows({ rows, collapsed: new Set() }).map((r) => r.id)).toEqual([
      'p1',
      'p1-c1',
      'p1-c2',
      'p2',
      'p2-c1',
    ]);
  });

  it('hides only the children of a collapsed parent, not other parents children', () => {
    expect(computeVisibleRows({ rows, collapsed: new Set(['p1']) }).map((r) => r.id)).toEqual(['p1', 'p2', 'p2-c1']);
  });

  it('hides all children when every parent is collapsed', () => {
    expect(computeVisibleRows({ rows, collapsed: new Set(['p1', 'p2']) }).map((r) => r.id)).toEqual(['p1', 'p2']);
  });
});

describe('computeAllCollapsed', () => {
  const rows = [
    makeRow({ id: 'p1', kind: 'parent' }),
    makeRow({ id: 'p1-c1', kind: 'child', parentId: 'p1' }),
    makeRow({ id: 'p2', kind: 'parent' }),
  ];

  it('is false when no parent is collapsed', () => {
    expect(computeAllCollapsed({ rows, collapsed: new Set() })).toBe(false);
  });

  it('is false when only some parents are collapsed', () => {
    expect(computeAllCollapsed({ rows, collapsed: new Set(['p1']) })).toBe(false);
  });

  it('is true when every parent is collapsed', () => {
    expect(computeAllCollapsed({ rows, collapsed: new Set(['p1', 'p2']) })).toBe(true);
  });

  it('is false when there are no parent rows', () => {
    const flatRows = [makeRow({ id: 'a' }), makeRow({ id: 'b' })];
    expect(computeAllCollapsed({ rows: flatRows, collapsed: new Set() })).toBe(false);
  });
});

describe('saved-view config matching', () => {
  const base: SavedPivotViewConfig = {
    rowDimension: 'category',
    granularity: 'monthly',
    measure: 'expense',
    from: '2024-01-01',
    to: '2024-12-31',
    accountIds: ['a', 'b'],
    categoryIds: [],
    payeeIds: undefined,
    heatmap: true,
    showDelta: true,
  };

  it('is order-insensitive on id arrays', () => {
    expect(arePivotConfigsEqual({ a: base, b: { ...base, accountIds: ['b', 'a'] } })).toBe(true);
  });

  it('detects a divergent field', () => {
    expect(arePivotConfigsEqual({ a: base, b: { ...base, measure: 'income' } })).toBe(false);
    expect(arePivotConfigsEqual({ a: base, b: { ...base, heatmap: false } })).toBe(false);
  });

  it('finds the matching view id, else null', () => {
    const views = [
      { id: 'v1', config: { ...base, measure: 'income' as const } },
      { id: 'v2', config: { ...base } },
    ];
    expect(findMatchingViewId({ config: base, views })).toBe('v2');
    expect(findMatchingViewId({ config: { ...base, granularity: 'yearly' }, views })).toBeNull();
  });
});
