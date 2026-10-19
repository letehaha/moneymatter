import type { CombinedBalanceHistoryEntity } from '@/api/stats';
import type { DashboardWidgetConfig } from '@/api/user-settings';
import { format, parseISO, startOfDay, subDays } from 'date-fns';

import { computePrevPeriod, computeTrendPeriods, isFullMonthPeriod } from '../cash-flow-widget/helpers';
import { type NetWorthIncludeSettings, composeNetWorth } from '../net-worth-composition';

export type { NetWorthIncludeSettings };

export type NetWorthComponentKey = 'ventures' | 'vehicles' | 'properties' | 'loans';

type NetWorthTrendBar = { label: string; shortLabel: string } & (
  | { hasData: false }
  | { hasData: true; delta: number; endNetWorth: number }
);

type NetWorthPrevDelta = { available: false } | { available: true; delta: number };

interface DatePeriod {
  from: Date;
  to: Date;
}

type Series = CombinedBalanceHistoryEntity[];

interface NormalizedPoint {
  time: number;
  point: CombinedBalanceHistoryEntity;
}

const INCLUDE_DEFAULT = true;

const dayOf = (value: Date | string) => startOfDay(typeof value === 'string' ? parseISO(value) : value).getTime();

/** Parses each date once and sorts ascending, so the lookups below can scan in order. */
function normalizeSeries({ series }: { series: Series }): NormalizedPoint[] {
  return series.map((point) => ({ time: dayOf(point.date), point })).sort((a, b) => a.time - b.time);
}

function lastPointBefore({
  normalized,
  date,
}: {
  normalized: NormalizedPoint[];
  date: Date;
}): CombinedBalanceHistoryEntity | null {
  const limit = dayOf(date);

  for (let i = normalized.length - 1; i >= 0; i--) {
    if (normalized[i]!.time < limit) return normalized[i]!.point;
  }

  return null;
}

function lastPointAtOrBefore({
  normalized,
  date,
}: {
  normalized: NormalizedPoint[];
  date: Date;
}): CombinedBalanceHistoryEntity | null {
  const limit = dayOf(date);

  for (let i = normalized.length - 1; i >= 0; i--) {
    if (normalized[i]!.time <= limit) return normalized[i]!.point;
  }

  return null;
}

function firstPointInRange({
  normalized,
  from,
  to,
}: {
  normalized: NormalizedPoint[];
  from: Date;
  to: Date;
}): CombinedBalanceHistoryEntity | null {
  const start = dayOf(from);
  const end = dayOf(to);

  for (const entry of normalized) {
    if (entry.time > end) break;
    if (entry.time >= start) return entry.point;
  }

  return null;
}

export function effectiveNetWorth({
  point,
  settings,
}: {
  point: CombinedBalanceHistoryEntity;
  settings: NetWorthIncludeSettings;
}): number {
  return composeNetWorth({ point, settings });
}

/** Absent or non-boolean stored values fall back to included, so a saved layout keeps counting every component. */
export function readNetWorthSettings({
  widgetConfig,
}: {
  widgetConfig: DashboardWidgetConfig | null | undefined;
}): NetWorthIncludeSettings {
  const config = widgetConfig?.config;
  const read = (value: unknown) => (typeof value === 'boolean' ? value : INCLUDE_DEFAULT);

  return {
    includeVentures: read(config?.includeVentures),
    includeVehicles: read(config?.includeVehicles),
    includeProperties: read(config?.includeProperties),
    includeLoans: read(config?.includeLoans),
  };
}

/**
 * Range the widget fetches: one day before the earliest trend window starts, so every
 * window (and the period itself) has a baseline point preceding it.
 */
export function computeFetchRange({ period }: { period: DatePeriod }): DatePeriod {
  const [earliestWindow] = computeTrendPeriods(period);

  return {
    from: subDays(earliestWindow.from, 1),
    to: period.to,
  };
}

function startNetWorthOf({
  normalized,
  settings,
  period,
}: {
  normalized: NormalizedPoint[];
  settings: NetWorthIncludeSettings;
  period: DatePeriod;
}): number | null {
  const point =
    lastPointBefore({ normalized, date: period.from }) ??
    firstPointInRange({ normalized, from: period.from, to: period.to });

  return point ? effectiveNetWorth({ point, settings }) : null;
}

function endNetWorthOf({
  normalized,
  settings,
  period,
}: {
  normalized: NormalizedPoint[];
  settings: NetWorthIncludeSettings;
  period: DatePeriod;
}): number | null {
  const point = lastPointAtOrBefore({ normalized, date: period.to });

  return point ? effectiveNetWorth({ point, settings }) : null;
}

/** Net worth entering the period: the last point before it, or the first point inside it. */
export function computeStartNetWorth({
  series,
  settings,
  period,
}: {
  series: Series;
  settings: NetWorthIncludeSettings;
  period: DatePeriod;
}): number | null {
  return startNetWorthOf({ normalized: normalizeSeries({ series }), settings, period });
}

export function computeEndNetWorth({
  series,
  settings,
  period,
}: {
  series: Series;
  settings: NetWorthIncludeSettings;
  period: DatePeriod;
}): number | null {
  return endNetWorthOf({ normalized: normalizeSeries({ series }), settings, period });
}

/**
 * Change over the window preceding the period — the previous calendar month for a
 * whole month, otherwise the same-length window ending the day before it.
 * Unavailable when the series holds nothing before the period, which makes the
 * comparison meaningless rather than zero.
 */
export function computePrevDelta({
  series,
  settings,
  period,
}: {
  series: Series;
  settings: NetWorthIncludeSettings;
  period: DatePeriod;
}): NetWorthPrevDelta {
  const normalized = normalizeSeries({ series });
  if (!lastPointBefore({ normalized, date: period.from })) return { available: false };

  const prevPeriod = computePrevPeriod(period);
  const start = startNetWorthOf({ normalized, settings, period: prevPeriod });
  const end = endNetWorthOf({ normalized, settings, period: prevPeriod });

  if (start === null || end === null) return { available: false };

  return { available: true, delta: end - start };
}

/** Null when either input is unknown or the starting net worth is zero — the ratio has no meaning there. */
export function computeGrowthPercent({
  currentDelta,
  startNetWorth,
}: {
  currentDelta: number | null;
  startNetWorth: number | null;
}): number | null {
  if (currentDelta === null || startNetWorth === null || startNetWorth === 0) return null;
  return (currentDelta / Math.abs(startNetWorth)) * 100;
}

/** The selected period and the five windows of the same shape before it, oldest first. */
export function computeTrendBars({
  series,
  settings,
  period,
}: {
  series: Series;
  settings: NetWorthIncludeSettings;
  period: DatePeriod;
}): NetWorthTrendBar[] {
  const normalized = normalizeSeries({ series });

  return computeTrendPeriods(period).map((window) => {
    const isWholeMonth = isFullMonthPeriod(window);
    const label = isWholeMonth
      ? format(window.from, 'MMM')
      : `${format(window.from, 'MMM d')} - ${format(window.to, 'MMM d')}`;
    const shortLabel = isWholeMonth ? format(window.from, 'MMM') : format(window.from, 'MMM yy');

    const endPoint = lastPointAtOrBefore({ normalized, date: window.to });
    if (!endPoint) return { label, shortLabel, hasData: false };

    const baselinePoint =
      lastPointBefore({ normalized, date: window.from }) ??
      firstPointInRange({ normalized, from: window.from, to: window.to }) ??
      endPoint;

    const endNetWorth = effectiveNetWorth({ point: endPoint, settings });

    return {
      label,
      shortLabel,
      hasData: true,
      delta: endNetWorth - effectiveNetWorth({ point: baselinePoint, settings }),
      endNetWorth,
    };
  });
}

export function excludedComponents({ settings }: { settings: NetWorthIncludeSettings }): NetWorthComponentKey[] {
  const excluded: NetWorthComponentKey[] = [];
  if (!settings.includeVentures) excluded.push('ventures');
  if (!settings.includeVehicles) excluded.push('vehicles');
  if (!settings.includeLoans) excluded.push('loans');
  return excluded;
}
