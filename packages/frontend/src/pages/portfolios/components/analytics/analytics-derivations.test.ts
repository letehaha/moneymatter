import { CATEGORICAL_SERIES_PALETTE, OTHERS_SERIES_COLOR } from '@/composable/charts/categorical-series-palette';
import { ALLOCATION_CASH_KEY } from '@bt/shared/types/investments';

import {
  DEFAULT_COMPARED_HOLDINGS,
  EXCLUDED_SERIES_COLORS,
  MAX_COMPARED_HOLDINGS,
  buildColorMap,
  getHoldingLabel,
  getLabelStep,
  groupAllocationTail,
  rebasePriceSeries,
  resolveBenchmark,
  resolveComparedIds,
  summarizeMonthlyGain,
} from './analytics-derivations';

describe('resolveBenchmark', () => {
  it('keeps a known key and drops anything else', () => {
    expect(resolveBenchmark({ stored: 'sp500' })).toBe('sp500');
    expect(resolveBenchmark({ stored: null })).toBeNull();
    expect(resolveBenchmark({ stored: 'constructor' })).toBeNull();
    expect(resolveBenchmark({ stored: 'dow' })).toBeNull();
  });
});

describe('buildColorMap', () => {
  it('gives every key a distinct color and cash the muted one without shifting the rest', () => {
    const withCash = buildColorMap({ keys: ['a', ALLOCATION_CASH_KEY, 'b'] });
    const withoutCash = buildColorMap({ keys: ['a', 'b'] });

    expect(withCash.get(ALLOCATION_CASH_KEY)).toBe(OTHERS_SERIES_COLOR);
    expect(withCash.get('a')).not.toBe(withCash.get('b'));
    expect(withCash.get('b')).toBe(withoutCash.get('b'));
  });

  it('cycles the palette without the excluded colors when keys outnumber it', () => {
    const paletteLength = CATEGORICAL_SERIES_PALETTE.length - EXCLUDED_SERIES_COLORS.length;
    const keys = Array.from({ length: 20 }, (_, index) => `k${index}`);
    const colors = buildColorMap({ keys });

    expect(new Set(colors.values()).size).toBe(paletteLength);
    for (const [index, key] of keys.entries()) {
      expect(EXCLUDED_SERIES_COLORS).not.toContain(colors.get(key));
      if (index >= paletteLength) expect(colors.get(key)).toBe(colors.get(keys[index - paletteLength]!));
    }
  });
});

describe('getHoldingLabel', () => {
  it('prefers the symbol, then the name', () => {
    expect(getHoldingLabel({ symbol: 'AAPL', name: 'Apple' })).toBe('AAPL');
    expect(getHoldingLabel({ symbol: null, name: 'Apple' })).toBe('Apple');
    expect(getHoldingLabel({})).toBe('—');
  });
});

describe('summarizeMonthlyGain', () => {
  it('returns null without months', () => {
    expect(summarizeMonthlyGain({ months: [] })).toBeNull();
  });

  it('totals the gains and picks the best and worst month', () => {
    const summary = summarizeMonthlyGain({
      months: [
        { month: '2026-01', gain: '100.50' },
        { month: '2026-02', gain: '-40.25' },
        { month: '2026-03', gain: '300.00' },
      ],
    });

    expect(summary?.total).toBeCloseTo(360.25);
    expect(summary?.best).toEqual({ month: '2026-03', gain: 300 });
    expect(summary?.worst).toEqual({ month: '2026-02', gain: -40.25 });
  });
});

describe('resolveComparedIds', () => {
  const heldIds = Array.from({ length: 12 }, (_, index) => `h${index}`);

  it('compares the largest holdings until the user picks', () => {
    expect(resolveComparedIds({ stored: null, heldIds })).toEqual(heldIds.slice(0, DEFAULT_COMPARED_HOLDINGS));
  });

  it('keeps the saved order, drops ids no longer held and duplicates, and caps the list', () => {
    expect(resolveComparedIds({ stored: ['h3', 'sold', 'h1', 'h3'], heldIds })).toEqual(['h3', 'h1']);
    expect(resolveComparedIds({ stored: heldIds, heldIds })).toHaveLength(MAX_COMPARED_HOLDINGS);
  });

  it('keeps an emptied list empty', () => {
    expect(resolveComparedIds({ stored: [], heldIds })).toEqual([]);
  });

  it('falls back to the largest holdings when the saved value is not a list', () => {
    expect(resolveComparedIds({ stored: { h1: true }, heldIds })).toEqual(heldIds.slice(0, DEFAULT_COMPARED_HOLDINGS));
    expect(resolveComparedIds({ stored: 'h1', heldIds })).toEqual(heldIds.slice(0, DEFAULT_COMPARED_HOLDINGS));
  });
});

describe('rebasePriceSeries', () => {
  const points = [
    { date: '2026-01-01', close: 50 },
    { date: '2026-02-01', close: 100 },
    { date: '2026-03-01', close: 110 },
    { date: '2026-04-01', close: 90 },
  ];

  it('starts at the first close on or after the start and stops at the end', () => {
    const series = rebasePriceSeries({ points, startDate: '2026-01-15', endDate: '2026-03-01' });

    expect(series.map(({ date }) => date)).toEqual(['2026-02-01', '2026-03-01']);
    expect(series[0]!.value).toBe(0);
    expect(series[1]!.value).toBeCloseTo(0.1);
  });

  it('returns nothing without a close in the window', () => {
    expect(rebasePriceSeries({ points, startDate: '2026-05-01', endDate: '2026-06-01' })).toEqual([]);
  });
});

describe('groupAllocationTail', () => {
  const entry = ({ key, weight }: { key: string; weight: number }) => ({ key, weight, value: weight * 1000 });

  it('folds the entries under the threshold into one', () => {
    const { kept, other } = groupAllocationTail({
      entries: [
        entry({ key: 'a', weight: 0.6 }),
        entry({ key: 'b', weight: 0.37 }),
        entry({ key: 'c', weight: 0.02 }),
        entry({ key: 'd', weight: 0.01 }),
      ],
      minWeight: 0.025,
    });

    expect(kept.map(({ key }) => key)).toEqual(['a', 'b']);
    expect(other).toEqual({ count: 2, value: expect.closeTo(30), weight: expect.closeTo(0.03) });
  });

  it('leaves a single small entry alone', () => {
    const entries = [
      entry({ key: 'a', weight: 0.6 }),
      entry({ key: 'b', weight: 0.39 }),
      entry({ key: 'c', weight: 0.01 }),
    ];

    expect(groupAllocationTail({ entries, minWeight: 0.02 })).toEqual({ kept: entries, other: null });
  });

  it('does not fold when fewer than two entries would remain', () => {
    const entries = [
      entry({ key: 'a', weight: 0.97 }),
      entry({ key: 'b', weight: 0.015 }),
      entry({ key: 'c', weight: 0.015 }),
    ];

    expect(groupAllocationTail({ entries, minWeight: 0.02 })).toEqual({ kept: entries, other: null });
  });
});

describe('getLabelStep', () => {
  it('shows every label when they fit', () => {
    expect(getLabelStep({ count: 12, width: 600, minLabelWidth: 40 })).toBe(1);
  });

  it('skips labels when they would overlap', () => {
    expect(getLabelStep({ count: 60, width: 600, minLabelWidth: 40 })).toBe(4);
  });

  it('shows a single label on a zero width', () => {
    expect(getLabelStep({ count: 5, width: 0, minLabelWidth: 40 })).toBe(5);
  });
});
