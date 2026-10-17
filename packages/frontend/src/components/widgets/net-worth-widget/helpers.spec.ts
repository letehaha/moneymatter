import type { CombinedBalanceHistoryEntity } from '@/api/stats';
import { format, parseISO } from 'date-fns';
import { describe, expect, it } from 'vitest';

import {
  type NetWorthIncludeSettings,
  computeEndNetWorth,
  computeFetchRange,
  computeGrowthPercent,
  computePrevDelta,
  computeStartNetWorth,
  computeTrendBars,
  effectiveNetWorth,
  excludedComponents,
  readNetWorthSettings,
} from './helpers';

const ymd = (date: Date) => format(date, 'yyyy-MM-dd');

const ALL_INCLUDED: NetWorthIncludeSettings = {
  includeVentures: true,
  includeVehicles: true,
  includeProperties: true,
  includeLoans: true,
};

const ALL_EXCLUDED: NetWorthIncludeSettings = {
  includeVentures: false,
  includeVehicles: false,
  includeProperties: false,
  includeLoans: false,
};

const widgetConfig = (config?: Record<string, unknown>) => ({ widgetId: 'net-worth', colSpan: 1, config });

const point = ({
  date,
  accounts = 0,
  portfolios = 0,
  ventures = 0,
  vehicles = 0,
  properties = 0,
  loans = 0,
}: {
  date: string;
  accounts?: number;
  portfolios?: number;
  ventures?: number;
  vehicles?: number;
  properties?: number;
  loans?: number;
}): CombinedBalanceHistoryEntity => ({
  date,
  accountsBalance: accounts,
  portfoliosBalance: portfolios,
  venturesBalance: ventures,
  vehiclesBalance: vehicles,
  propertiesBalance: properties,
  loansBalance: loans,
  totalBalance: accounts + portfolios + ventures + vehicles + properties + loans,
});

const POINT = point({ date: '2026-07-15', accounts: 1000, portfolios: 500, ventures: 200, vehicles: 300, loans: -400 });

// Jun 30 baseline + one point per month end, Feb..Jul 2026.
const SERIES: CombinedBalanceHistoryEntity[] = [
  point({ date: '2026-01-31', accounts: 1000 }),
  point({ date: '2026-02-28', accounts: 1200 }),
  point({ date: '2026-03-31', accounts: 1100 }),
  point({ date: '2026-04-30', accounts: 1500 }),
  point({ date: '2026-05-31', accounts: 1400 }),
  point({ date: '2026-06-30', accounts: 2000 }),
  point({ date: '2026-07-10', accounts: 2200 }),
  point({ date: '2026-07-31', accounts: 2600 }),
];

const JULY = { from: parseISO('2026-07-01'), to: parseISO('2026-07-31') };
const QUARTER = { from: parseISO('2026-07-01'), to: parseISO('2026-09-30') };

describe('effectiveNetWorth', () => {
  it('sums every component when all are included', () => {
    expect(effectiveNetWorth({ point: POINT, settings: ALL_INCLUDED })).toBe(1600);
  });

  it('always counts accounts and portfolios', () => {
    expect(effectiveNetWorth({ point: POINT, settings: ALL_EXCLUDED })).toBe(1500);
  });

  it('raises net worth when loans are excluded (loan balances are negative)', () => {
    const withLoans = effectiveNetWorth({ point: POINT, settings: ALL_INCLUDED });
    const withoutLoans = effectiveNetWorth({ point: POINT, settings: { ...ALL_INCLUDED, includeLoans: false } });

    expect(withoutLoans - withLoans).toBe(400);
  });

  it('drops only ventures when ventures are excluded', () => {
    expect(effectiveNetWorth({ point: POINT, settings: { ...ALL_INCLUDED, includeVentures: false } })).toBe(1400);
  });

  it('drops only vehicles when vehicles are excluded', () => {
    expect(effectiveNetWorth({ point: POINT, settings: { ...ALL_INCLUDED, includeVehicles: false } })).toBe(1300);
  });
});

describe('readNetWorthSettings', () => {
  it('includes everything without an injected widget config', () => {
    expect(readNetWorthSettings({ widgetConfig: null })).toEqual(ALL_INCLUDED);
    expect(readNetWorthSettings({ widgetConfig: undefined })).toEqual(ALL_INCLUDED);
  });

  it('includes everything for an empty config', () => {
    expect(readNetWorthSettings({ widgetConfig: widgetConfig() })).toEqual(ALL_INCLUDED);
    expect(readNetWorthSettings({ widgetConfig: widgetConfig({}) })).toEqual(ALL_INCLUDED);
  });

  it('defaults the toggles a partial config omits', () => {
    expect(readNetWorthSettings({ widgetConfig: widgetConfig({ includeLoans: false }) })).toEqual({
      includeVentures: true,
      includeVehicles: true,
      includeProperties: true,
      includeLoans: false,
    });
  });

  it('reads every stored toggle', () => {
    expect(
      readNetWorthSettings({
        widgetConfig: widgetConfig({
          includeVentures: false,
          includeVehicles: false,
          includeProperties: false,
          includeLoans: false,
        }),
      }),
    ).toEqual(ALL_EXCLUDED);
  });

  it('falls back to the default for non-boolean stored values', () => {
    expect(
      readNetWorthSettings({
        widgetConfig: widgetConfig({
          includeVentures: 'false',
          includeVehicles: 0,
          includeProperties: [],
          includeLoans: {},
        }),
      }),
    ).toEqual(ALL_INCLUDED);
  });
});

describe('computeFetchRange', () => {
  it('starts one day before the sixth month back', () => {
    const range = computeFetchRange({ period: JULY });

    expect(ymd(range.from)).toBe('2026-01-31');
    expect(ymd(range.to)).toBe('2026-07-31');
  });

  it('covers the earliest quarter-length window plus its baseline day', () => {
    const range = computeFetchRange({ period: QUARTER });

    expect(ymd(range.from)).toBe('2025-03-27');
    expect(ymd(range.to)).toBe('2026-09-30');
  });
});

describe('computeStartNetWorth', () => {
  it('uses the last point before the period', () => {
    expect(computeStartNetWorth({ series: SERIES, settings: ALL_INCLUDED, period: JULY })).toBe(2000);
  });

  it('falls back to the first point inside the period when nothing precedes it', () => {
    const series = [point({ date: '2026-07-10', accounts: 2200 }), point({ date: '2026-07-31', accounts: 2600 })];

    expect(computeStartNetWorth({ series, settings: ALL_INCLUDED, period: JULY })).toBe(2200);
  });

  it('falls back to a point landing exactly on the period start', () => {
    const series = [point({ date: '2026-07-01', accounts: 500 }), point({ date: '2026-07-31', accounts: 900 })];

    expect(computeStartNetWorth({ series, settings: ALL_INCLUDED, period: JULY })).toBe(500);
    expect(computeEndNetWorth({ series, settings: ALL_INCLUDED, period: JULY })).toBe(900);
  });

  it('returns null for an empty series', () => {
    expect(computeStartNetWorth({ series: [], settings: ALL_INCLUDED, period: JULY })).toBeNull();
  });

  it('returns null when every point comes after the period', () => {
    const series = [point({ date: '2026-09-30', accounts: 3000 })];

    expect(computeStartNetWorth({ series, settings: ALL_INCLUDED, period: JULY })).toBeNull();
  });
});

describe('computeEndNetWorth', () => {
  it('uses the last point at or before the period end', () => {
    expect(computeEndNetWorth({ series: SERIES, settings: ALL_INCLUDED, period: JULY })).toBe(2600);
  });

  it('ignores the time of day on the period end', () => {
    const period = { from: parseISO('2026-07-01'), to: parseISO('2026-07-31T23:59:59.999') };

    expect(computeEndNetWorth({ series: SERIES, settings: ALL_INCLUDED, period })).toBe(2600);
  });

  it('carries the last known point forward when the period has no data', () => {
    const period = { from: parseISO('2026-08-01'), to: parseISO('2026-08-31') };

    expect(computeEndNetWorth({ series: SERIES, settings: ALL_INCLUDED, period })).toBe(2600);
  });

  it('returns null for an empty series', () => {
    expect(computeEndNetWorth({ series: [], settings: ALL_INCLUDED, period: JULY })).toBeNull();
  });
});

describe('computePrevDelta', () => {
  it('uses the previous calendar month for a full month', () => {
    // Jun 1–30: starts at the May 31 point (1400), ends at the Jun 30 point (2000).
    expect(computePrevDelta({ series: SERIES, settings: ALL_INCLUDED, period: JULY })).toEqual({
      available: true,
      delta: 600,
    });
  });

  it('reports no previous data when nothing precedes the period', () => {
    const series = [point({ date: '2026-07-10', accounts: 2200 })];

    expect(computePrevDelta({ series, settings: ALL_INCLUDED, period: JULY })).toEqual({ available: false });
  });

  it('reports no previous data for an empty series', () => {
    expect(computePrevDelta({ series: [], settings: ALL_INCLUDED, period: JULY })).toEqual({ available: false });
  });

  it('uses the same day count for a custom range', () => {
    // Jul 11–20 is 10 days → previous window is Jul 1–10: starts at Jun 30 (2000), ends at Jul 10 (2200).
    const period = { from: parseISO('2026-07-11'), to: parseISO('2026-07-20') };

    expect(computePrevDelta({ series: SERIES, settings: ALL_INCLUDED, period })).toEqual({
      available: true,
      delta: 200,
    });
  });
});

describe('computeGrowthPercent', () => {
  it('divides by the absolute starting net worth', () => {
    expect(computeGrowthPercent({ currentDelta: 300, startNetWorth: 1500 })).toBe(20);
  });

  it('keeps the delta sign when the start is negative', () => {
    expect(computeGrowthPercent({ currentDelta: 300, startNetWorth: -1500 })).toBe(20);
  });

  it('returns null when the start is zero', () => {
    expect(computeGrowthPercent({ currentDelta: 300, startNetWorth: 0 })).toBeNull();
  });

  it('returns null when either input is unknown', () => {
    expect(computeGrowthPercent({ currentDelta: null, startNetWorth: 1500 })).toBeNull();
    expect(computeGrowthPercent({ currentDelta: 300, startNetWorth: null })).toBeNull();
  });
});

describe('computeTrendBars', () => {
  it('returns six calendar months for a full-month period', () => {
    const bars = computeTrendBars({ series: SERIES, settings: ALL_INCLUDED, period: JULY });

    expect(bars.map((bar) => bar.shortLabel)).toEqual(['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']);
    expect(bars.map((bar) => bar.label)).toEqual(['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']);
  });

  it('day-qualifies every label for a sub-month period', () => {
    const period = { from: parseISO('2026-07-11'), to: parseISO('2026-07-20') };
    const labels = computeTrendBars({ series: SERIES, settings: ALL_INCLUDED, period }).map((bar) => bar.label);

    expect(labels).toEqual([
      'May 22 - May 31',
      'Jun 1 - Jun 10',
      'Jun 11 - Jun 20',
      'Jun 21 - Jun 30',
      'Jul 1 - Jul 10',
      'Jul 11 - Jul 20',
    ]);
    expect(new Set(labels).size).toBe(6);
  });

  it('measures each month against the last point before it', () => {
    const bars = computeTrendBars({ series: SERIES, settings: ALL_INCLUDED, period: JULY });

    // Feb: 1200 - 1000 (Jan 31 baseline). Mar: 1100 - 1200. Jul: 2600 - 2000 (Jun 30 baseline).
    expect(bars.map((bar) => (bar.hasData ? bar.delta : null))).toEqual([200, -100, 400, -100, 600, 600]);
    expect(bars.map((bar) => (bar.hasData ? bar.endNetWorth : null))).toEqual([1200, 1100, 1500, 1400, 2000, 2600]);
  });

  it('measures against the first in-window point when nothing precedes it', () => {
    const series = [point({ date: '2026-07-10', accounts: 2200 }), point({ date: '2026-07-31', accounts: 2600 })];
    const bars = computeTrendBars({ series, settings: ALL_INCLUDED, period: JULY });

    expect(bars[5]).toEqual({ label: 'Jul', shortLabel: 'Jul', hasData: true, delta: 400, endNetWorth: 2600 });
    expect(bars.slice(0, 5).every((bar) => !bar.hasData)).toBe(true);
  });

  it('carries the last known value with a zero delta for windows without points', () => {
    const series = [point({ date: '2026-02-28', accounts: 1200 })];
    const bars = computeTrendBars({ series, settings: ALL_INCLUDED, period: JULY });

    expect(bars[5]).toEqual({ label: 'Jul', shortLabel: 'Jul', hasData: true, delta: 0, endNetWorth: 1200 });
  });

  it('marks every bar as having no data for an empty series', () => {
    const bars = computeTrendBars({ series: [], settings: ALL_INCLUDED, period: JULY });

    expect(bars).toHaveLength(6);
    expect(bars.every((bar) => !bar.hasData)).toBe(true);
  });

  it('applies the include settings to every window', () => {
    const series = [
      point({ date: '2026-06-30', accounts: 1000, loans: -500 }),
      point({ date: '2026-07-31', accounts: 1000, loans: -200 }),
    ];

    const withLoans = computeTrendBars({ series, settings: ALL_INCLUDED, period: JULY });
    const withoutLoans = computeTrendBars({
      series,
      settings: { ...ALL_INCLUDED, includeLoans: false },
      period: JULY,
    });

    const lastDelta = (bars: ReturnType<typeof computeTrendBars>) => {
      const bar = bars[5]!;
      return bar.hasData ? bar.delta : null;
    };

    expect(lastDelta(withLoans)).toBe(300);
    expect(lastDelta(withoutLoans)).toBe(0);
  });

  it('tiles six quarter-length windows back-to-back for a quarter period', () => {
    const bars = computeTrendBars({ series: [], settings: ALL_INCLUDED, period: QUARTER });

    expect(bars).toHaveLength(6);
    expect(bars.map((bar) => bar.shortLabel)).toEqual(['Mar 25', 'Jun 25', 'Sep 25', 'Dec 25', 'Mar 26', 'Jul 26']);
    expect(bars.map((bar) => bar.label)).toEqual([
      'Mar 28 - Jun 27',
      'Jun 28 - Sep 27',
      'Sep 28 - Dec 28',
      'Dec 29 - Mar 30',
      'Mar 31 - Jun 30',
      'Jul 1 - Sep 30',
    ]);
  });

  it('measures a quarter window end-to-end against the point before it', () => {
    const series = [
      point({ date: '2026-06-30', accounts: 1000 }),
      point({ date: '2026-08-15', accounts: 1200 }),
      point({ date: '2026-09-30', accounts: 1800 }),
    ];
    const bars = computeTrendBars({ series, settings: ALL_INCLUDED, period: QUARTER });

    expect(bars[5]).toEqual({
      label: 'Jul 1 - Sep 30',
      shortLabel: 'Jul 26',
      hasData: true,
      delta: 800,
      endNetWorth: 1800,
    });
  });

  it('does not depend on the order the series arrives in', () => {
    const ascending = computeTrendBars({ series: SERIES, settings: ALL_INCLUDED, period: JULY });
    const descending = computeTrendBars({ series: [...SERIES].reverse(), settings: ALL_INCLUDED, period: JULY });

    expect(descending).toEqual(ascending);
  });
});

describe('excludedComponents', () => {
  it('lists every excluded component in bar order', () => {
    expect(excludedComponents({ settings: ALL_EXCLUDED })).toEqual(['ventures', 'vehicles', 'loans']);
  });

  it('lists only the excluded ones', () => {
    expect(excludedComponents({ settings: { ...ALL_INCLUDED, includeLoans: false } })).toEqual(['loans']);
  });

  it('is empty when everything is included', () => {
    expect(excludedComponents({ settings: ALL_INCLUDED })).toEqual([]);
  });
});
