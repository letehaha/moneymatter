import {
  ACCOUNT_CATEGORIES,
  MAX_NET_WORTH_HISTORY_BUCKETS,
  type NetWorthLiabilityKind,
  type NetWorthAssetKind,
  NET_WORTH_ASSET_KINDS,
  type NetWorthHistoryPoint,
} from '@bt/shared/types';
import { addDays, addWeeks, startOfISOWeek } from 'date-fns';
import { describe, expect, it } from 'vitest';

import {
  annualizedGrowthPct,
  assetKindsWithActivity,
  autoGranularity,
  averageOwedLiabilities,
  buildDisplayPoints,
  computeLiabilityScale,
  computePeriodChange,
  countBuckets,
  disabledGranularities,
  kindsWithActivity,
  resolveSelectedKinds,
} from './net-worth-history-derivations';

const CREDIT_CARD = ACCOUNT_CATEGORIES.creditCard as NetWorthLiabilityKind;
const LOAN = ACCOUNT_CATEGORIES.loan as NetWorthLiabilityKind;
const OVERDRAFT = ACCOUNT_CATEGORIES.overdraft as NetWorthLiabilityKind;

const CASH: NetWorthAssetKind = 'cash';
const INVESTMENTS: NetWorthAssetKind = 'investments';
const VEHICLES: NetWorthAssetKind = 'vehicles';
const ALL_ASSET_KINDS: NetWorthAssetKind[] = [...NET_WORTH_ASSET_KINDS];

const buildPoint = ({
  date,
  // `assets` is shorthand for the `cash` kind — most tests only need one asset bucket.
  assets = 0,
  investments = 0,
  vehicles = 0,
  ventures = 0,
  creditCard = 0,
  loan = 0,
  overdraft = 0,
}: {
  date: string;
  assets?: number;
  investments?: number;
  vehicles?: number;
  ventures?: number;
  creditCard?: number;
  loan?: number;
  overdraft?: number;
}): NetWorthHistoryPoint => {
  const assetsByKind = { cash: assets, investments, vehicles, ventures };
  const assetsTotal = assets + investments + vehicles + ventures;
  const liabilitiesTotal = creditCard + loan + overdraft;
  return {
    date,
    assets: assetsByKind,
    assetsTotal,
    liabilities: { 'credit-card': creditCard, loan, overdraft },
    liabilitiesTotal,
    netWorth: assetsTotal + liabilitiesTotal,
  };
};

describe('kindsWithActivity', () => {
  it('keeps only kinds with a nonzero balance somewhere in the series', () => {
    const kinds = kindsWithActivity({
      points: [
        buildPoint({ date: '2026-01-31', assets: 100, creditCard: -50 }),
        buildPoint({ date: '2026-02-28', assets: 120, loan: -200 }),
      ],
    });

    expect(kinds).toEqual([CREDIT_CARD, LOAN]);
  });

  it('counts a positive (overpaid) balance as activity', () => {
    const kinds = kindsWithActivity({ points: [buildPoint({ date: '2026-01-31', creditCard: 25 })] });

    expect(kinds).toEqual([CREDIT_CARD]);
  });

  it('returns empty for a debt-free series', () => {
    expect(kindsWithActivity({ points: [buildPoint({ date: '2026-01-31', assets: 100 })] })).toEqual([]);
  });
});

describe('assetKindsWithActivity', () => {
  it('keeps only asset kinds with a nonzero balance somewhere in the series', () => {
    const kinds = assetKindsWithActivity({
      points: [buildPoint({ date: '2026-01-31', assets: 100 }), buildPoint({ date: '2026-02-28', vehicles: 25_000 })],
    });

    expect(kinds).toEqual([CASH, VEHICLES]);
  });

  it('counts a negative (overdrawn) cash balance as activity', () => {
    expect(assetKindsWithActivity({ points: [buildPoint({ date: '2026-01-31', assets: -40 })] })).toEqual([CASH]);
  });

  it('returns empty for an all-zero series', () => {
    expect(assetKindsWithActivity({ points: [buildPoint({ date: '2026-01-31' })] })).toEqual([]);
  });
});

describe('resolveSelectedKinds', () => {
  it('treats an empty selection as all available kinds', () => {
    expect(resolveSelectedKinds({ stored: [], available: [CREDIT_CARD, LOAN] })).toEqual([CREDIT_CARD, LOAN]);
  });

  it('drops stored kinds absent from the loaded series', () => {
    expect(resolveSelectedKinds({ stored: [OVERDRAFT, LOAN], available: [LOAN] })).toEqual([LOAN]);
  });

  it('falls back to all when nothing stored survives', () => {
    expect(resolveSelectedKinds({ stored: [OVERDRAFT], available: [CREDIT_CARD] })).toEqual([CREDIT_CARD]);
  });

  it('resolves asset kinds through the same generic helper', () => {
    expect(resolveSelectedKinds({ stored: [INVESTMENTS], available: [CASH, INVESTMENTS] })).toEqual([INVESTMENTS]);
  });
});

describe('buildDisplayPoints', () => {
  it('sums only the selected liability kinds and rebuilds net worth from them', () => {
    const [point] = buildDisplayPoints({
      points: [buildPoint({ date: '2026-01-31', assets: 1000, creditCard: -100, loan: -400 })],
      selectedAssetKinds: [CASH],
      selectedLiabilityKinds: [CREDIT_CARD],
    });

    expect(point).toEqual({
      date: '2026-01-31',
      assetsByKind: { cash: 1000 },
      assetsTotal: 1000,
      liabilitiesByKind: { 'credit-card': -100 },
      liabilitiesTotal: -100,
      netWorth: 900,
    });
  });

  it('sums only the selected asset kinds and rebuilds assets and net worth', () => {
    const [point] = buildDisplayPoints({
      points: [buildPoint({ date: '2026-01-31', assets: 1000, investments: 5000, vehicles: 2000, creditCard: -100 })],
      selectedAssetKinds: [CASH, INVESTMENTS],
      selectedLiabilityKinds: [CREDIT_CARD],
    });

    expect(point).toEqual({
      date: '2026-01-31',
      assetsByKind: { cash: 1000, investments: 5000 },
      assetsTotal: 6000,
      liabilitiesByKind: { 'credit-card': -100 },
      liabilitiesTotal: -100,
      netWorth: 5900,
    });
  });

  it('matches the server totals when every kind is selected', () => {
    const [point] = buildDisplayPoints({
      points: [buildPoint({ date: '2026-01-31', assets: 1000, creditCard: -100, loan: -400, overdraft: -50 })],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [CREDIT_CARD, LOAN, OVERDRAFT],
    });

    expect(point!.assetsTotal).toBe(1000);
    expect(point!.liabilitiesTotal).toBe(-550);
    expect(point!.netWorth).toBe(450);
  });
});

describe('averageOwedLiabilities', () => {
  it('reports the mean owed amount as a positive magnitude', () => {
    const points = buildDisplayPoints({
      points: [
        buildPoint({ date: '2026-01-31', creditCard: -100 }),
        buildPoint({ date: '2026-02-28', creditCard: -300 }),
      ],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [CREDIT_CARD],
    });

    expect(averageOwedLiabilities({ points })).toBe(200);
  });

  it('reads as zero when the mean is overpaid or flat', () => {
    const points = buildDisplayPoints({
      points: [buildPoint({ date: '2026-01-31', creditCard: 50 }), buildPoint({ date: '2026-02-28', creditCard: -30 })],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [CREDIT_CARD],
    });

    expect(averageOwedLiabilities({ points })).toBe(0);
    expect(averageOwedLiabilities({ points: [] })).toBe(0);
  });
});

describe('computeLiabilityScale', () => {
  const displayPoints = ({
    entries,
  }: {
    entries: { date: string; assets?: number; creditCard?: number; loan?: number }[];
  }) =>
    buildDisplayPoints({
      points: entries.map((entry) => buildPoint(entry)),
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [CREDIT_CARD, LOAN],
    });

  it('zooms when owed totals are tiny next to the positive extreme', () => {
    const points = displayPoints({
      entries: [
        { date: '2026-01-31', assets: 374_000, creditCard: -2_700 },
        { date: '2026-02-28', assets: 380_000, creditCard: -1_200 },
      ],
    });

    expect(computeLiabilityScale({ points })).toEqual({
      asymmetric: true,
      maxPositive: 380_000,
      maxOwed: 2_700,
    });
  });

  it('stays on the shared scale when there is nothing owed', () => {
    const points = displayPoints({ entries: [{ date: '2026-01-31', assets: 1000 }] });

    expect(computeLiabilityScale({ points }).asymmetric).toBe(false);
  });

  it('stays on the shared scale when owed reaches a tenth of the positive extreme', () => {
    const points = displayPoints({
      entries: [{ date: '2026-01-31', assets: 1000, loan: -100 }],
    });

    expect(computeLiabilityScale({ points }).asymmetric).toBe(false);
  });

  it('stays on the shared scale when any net worth dips negative', () => {
    const points = displayPoints({
      entries: [
        { date: '2026-01-31', assets: 100_000, loan: -900 },
        { date: '2026-02-28', assets: 500, loan: -900 },
      ],
    });

    expect(computeLiabilityScale({ points }).asymmetric).toBe(false);
  });

  it('stays on the shared scale when an asset kind hangs below the baseline', () => {
    // Totals stay positive (big investments), but an overdrawn cash bucket puts a
    // segment below zero — the zoomed owed sub-scale can't honestly hold it, so the
    // chart must fall back to the shared scale rather than scale it like a liability.
    const points = buildDisplayPoints({
      points: [
        buildPoint({ date: '2026-01-31', assets: -1_524, investments: 340_000, creditCard: -500 }),
        buildPoint({ date: '2026-02-28', investments: 345_000, creditCard: -400 }),
      ],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [CREDIT_CARD],
    });

    expect(computeLiabilityScale({ points }).asymmetric).toBe(false);
  });

  it('counts a positive liability sum toward the positive extreme, not owed', () => {
    const points = displayPoints({
      entries: [{ date: '2026-01-31', assets: 1000, loan: 50 }],
    });

    const scale = computeLiabilityScale({ points });
    expect(scale.maxOwed).toBe(0);
    expect(scale.maxPositive).toBe(1050);
    expect(scale.asymmetric).toBe(false);
  });

  it('never zooms when the user turned zooming off', () => {
    const points = displayPoints({
      entries: [
        { date: '2026-01-31', assets: 374_000, creditCard: -2_700 },
        { date: '2026-02-28', assets: 380_000, creditCard: -1_200 },
      ],
    });

    expect(computeLiabilityScale({ points, zoomEnabled: false }).asymmetric).toBe(false);
  });
});

describe('computePeriodChange', () => {
  it('returns last-minus-first with a percentage against the first point', () => {
    const points = buildDisplayPoints({
      points: [buildPoint({ date: '2026-01-31', assets: 1000 }), buildPoint({ date: '2026-06-30', assets: 1500 })],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [],
    });

    expect(computePeriodChange({ points })).toEqual({ amount: 500, pct: 50 });
  });

  it('keeps the percentage meaningful when starting from negative net worth', () => {
    const points = buildDisplayPoints({
      points: [
        buildPoint({ date: '2026-01-31', assets: 100, loan: -300 }),
        buildPoint({ date: '2026-06-30', assets: 100, loan: -100 }),
      ],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [LOAN],
    });

    expect(computePeriodChange({ points })).toEqual({ amount: 200, pct: 100 });
  });

  it('suppresses the percentage when the first point is zero', () => {
    const points = buildDisplayPoints({
      points: [buildPoint({ date: '2026-01-31' }), buildPoint({ date: '2026-06-30', assets: 500 })],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [],
    });

    expect(computePeriodChange({ points })).toEqual({ amount: 500, pct: null });
    expect(computePeriodChange({ points: [] })).toEqual({ amount: 0, pct: null });
  });
});

describe('annualizedGrowthPct', () => {
  it('annualizes net-worth growth over a multi-year range', () => {
    // 100k → 200k over exactly two years compounds to ~41.4%/yr.
    const points = buildDisplayPoints({
      points: [
        buildPoint({ date: '2024-01-01', investments: 100_000 }),
        buildPoint({ date: '2026-01-01', investments: 200_000 }),
      ],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [],
    });

    const pct = annualizedGrowthPct({ points });
    expect(pct).not.toBeNull();
    expect(pct!).toBeCloseTo(41.4, 0);
  });

  it('does not annualize ranges shorter than a year', () => {
    const points = buildDisplayPoints({
      points: [
        buildPoint({ date: '2026-01-01', investments: 100_000 }),
        buildPoint({ date: '2026-06-30', investments: 150_000 }),
      ],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [],
    });

    expect(annualizedGrowthPct({ points })).toBeNull();
  });

  it('is null when an endpoint net worth is not positive', () => {
    const points = buildDisplayPoints({
      points: [
        buildPoint({ date: '2024-01-01', investments: 100, loan: -100 }),
        buildPoint({ date: '2026-01-01', investments: 5000 }),
      ],
      selectedAssetKinds: ALL_ASSET_KINDS,
      selectedLiabilityKinds: [LOAN],
    });

    expect(annualizedGrowthPct({ points })).toBeNull();
  });
});

describe('granularity helpers', () => {
  it('counts calendar buckets per granularity', () => {
    const range = { from: new Date(2026, 0, 1), to: new Date(2026, 11, 31) };

    expect(countBuckets({ ...range, granularity: 'weekly' })).toBe(53);
    expect(countBuckets({ ...range, granularity: 'monthly' })).toBe(12);
    expect(countBuckets({ ...range, granularity: 'quarterly' })).toBe(4);
    expect(countBuckets({ ...range, granularity: 'yearly' })).toBe(1);
  });

  it('picks the auto granularity from the period length', () => {
    const from = new Date(2026, 0, 1);

    expect(autoGranularity({ from, to: new Date(2026, 1, 15) })).toBe('weekly');
    expect(autoGranularity({ from, to: new Date(2026, 11, 31) })).toBe('weekly');
    expect(autoGranularity({ from, to: new Date(2029, 11, 31) })).toBe('monthly');
    expect(autoGranularity({ from, to: new Date(2036, 11, 31) })).toBe('quarterly');
  });

  it('sits exactly on both auto-granularity day thresholds', () => {
    const from = new Date(2026, 0, 1);

    // 370 vs 371 inclusive days (differenceInCalendarDays + 1).
    expect(autoGranularity({ from, to: addDays(from, 369) })).toBe('weekly');
    expect(autoGranularity({ from, to: addDays(from, 370) })).toBe('monthly');

    // 1850 vs 1851 inclusive days.
    expect(autoGranularity({ from, to: addDays(from, 1849) })).toBe('monthly');
    expect(autoGranularity({ from, to: addDays(from, 1850) })).toBe('quarterly');
  });

  it('disables granularities whose bucket count exceeds the cap', () => {
    // ~13 years: weekly = ~680 buckets > 500, monthly and coarser stay allowed.
    const disabled = disabledGranularities({ from: new Date(2013, 0, 1), to: new Date(2025, 11, 31) });

    expect(disabled).toEqual(['weekly']);
    expect(
      countBuckets({ from: new Date(2013, 0, 1), to: new Date(2025, 11, 31), granularity: 'monthly' }),
    ).toBeLessThanOrEqual(MAX_NET_WORTH_HISTORY_BUCKETS);
  });

  it('treats the bucket cap as exclusive, not inclusive', () => {
    const from = startOfISOWeek(new Date(2015, 0, 1));
    const atCap = addWeeks(from, MAX_NET_WORTH_HISTORY_BUCKETS - 1);
    const overCap = addWeeks(from, MAX_NET_WORTH_HISTORY_BUCKETS);

    expect(countBuckets({ from, to: atCap, granularity: 'weekly' })).toBe(MAX_NET_WORTH_HISTORY_BUCKETS);
    expect(disabledGranularities({ from, to: atCap })).not.toContain('weekly');

    expect(countBuckets({ from, to: overCap, granularity: 'weekly' })).toBe(MAX_NET_WORTH_HISTORY_BUCKETS + 1);
    expect(disabledGranularities({ from, to: overCap })).toContain('weekly');
  });

  it('never lets the auto choice exceed the cap', () => {
    const from = new Date(2000, 0, 1);
    const to = new Date(2026, 6, 24);

    const granularity = autoGranularity({ from, to });
    expect(countBuckets({ from, to, granularity })).toBeLessThanOrEqual(MAX_NET_WORTH_HISTORY_BUCKETS);
  });
});
