import {
  MAX_NET_WORTH_HISTORY_BUCKETS,
  type NetWorthAssetKind,
  type NetWorthLiabilityKind,
  type NetWorthHistoryPoint,
  NET_WORTH_LIABILITY_KINDS,
  NET_WORTH_ASSET_KINDS,
  type NetWorthHistoryGranularity,
  NET_WORTH_HISTORY_GRANULARITIES,
} from '@bt/shared/types';
import {
  differenceInCalendarDays,
  differenceInCalendarISOWeeks,
  differenceInCalendarMonths,
  differenceInCalendarQuarters,
  differenceInCalendarYears,
  parseISO,
} from 'date-fns';

// One color per asset kind for the stacked bars, legend and tooltip dots. Fixed
// mid-tone hues (Tailwind ~500 weight) that stay legible on both themes; cash keeps
// a green so it still reads as the classic "assets" color. Liabilities stay red and
// the net-worth line stays the theme foreground, so they never collide with these.
export const NET_WORTH_ASSET_KIND_COLORS: Record<NetWorthAssetKind, string> = {
  cash: 'rgb(16, 185, 129)', // emerald
  investments: 'rgb(59, 130, 246)', // blue
  vehicles: 'rgb(245, 158, 11)', // amber
  ventures: 'rgb(168, 85, 247)', // purple
};

/** i18n label key per asset kind, shared by the filter, legend and tooltip. */
export const NET_WORTH_ASSET_KIND_LABEL_KEYS: Record<NetWorthAssetKind, string> = {
  cash: 'netWorthHistory.assetKinds.cash',
  investments: 'netWorthHistory.assetKinds.investments',
  vehicles: 'netWorthHistory.assetKinds.vehicles',
  ventures: 'netWorthHistory.assetKinds.ventures',
};

export interface NetWorthDisplayPoint {
  /** yyyy-MM-dd bucket-end date the snapshot is taken at. */
  date: string;
  /** Signed per-kind values for the selected asset kinds only, for the stacked bars and tooltip. */
  assetsByKind: Partial<Record<NetWorthAssetKind, number>>;
  /** Sum of the selected asset kinds; equals the server's assetsTotal when every kind is selected. */
  assetsTotal: number;
  /** Signed per-kind values for the selected liability kinds only, for the tooltip breakdown. */
  liabilitiesByKind: Partial<Record<NetWorthLiabilityKind, number>>;
  /** Sum of the selected kinds' signed values — negative = owed. */
  liabilitiesTotal: number;
  /** assetsTotal + liabilitiesTotal; equals the server's netWorth when every kind is selected. */
  netWorth: number;
}

/** Liability kinds with a nonzero balance anywhere in the series, in canonical order. */
export const kindsWithActivity = ({ points }: { points: NetWorthHistoryPoint[] }): NetWorthLiabilityKind[] =>
  NET_WORTH_LIABILITY_KINDS.filter((kind) => points.some((point) => (point.liabilities[kind] ?? 0) !== 0));

/** Asset kinds with a nonzero balance anywhere in the series, in canonical order. */
export const assetKindsWithActivity = ({ points }: { points: NetWorthHistoryPoint[] }): NetWorthAssetKind[] =>
  NET_WORTH_ASSET_KINDS.filter((kind) => points.some((point) => (point.assets[kind] ?? 0) !== 0));

/**
 * Empty selection is the "all kinds" sentinel. A stored kind that has no activity
 * in the loaded series is dropped; if nothing valid remains, fall back to all.
 * Generic over the kind so the asset and liability filters share one resolver.
 */
export const resolveSelectedKinds = <T extends string>({ stored, available }: { stored: T[]; available: T[] }): T[] => {
  if (stored.length === 0) return available;
  const availableSet = new Set(available);
  const valid = stored.filter((kind) => availableSet.has(kind));
  return valid.length > 0 ? valid : available;
};

export const buildDisplayPoints = ({
  points,
  selectedAssetKinds,
  selectedLiabilityKinds,
}: {
  points: NetWorthHistoryPoint[];
  selectedAssetKinds: NetWorthAssetKind[];
  selectedLiabilityKinds: NetWorthLiabilityKind[];
}): NetWorthDisplayPoint[] =>
  points.map((point) => {
    const assetsByKind: NetWorthDisplayPoint['assetsByKind'] = {};
    let assetsTotal = 0;
    for (const kind of selectedAssetKinds) {
      const value = point.assets[kind] ?? 0;
      assetsByKind[kind] = value;
      assetsTotal += value;
    }

    const liabilitiesByKind: NetWorthDisplayPoint['liabilitiesByKind'] = {};
    let liabilitiesTotal = 0;
    for (const kind of selectedLiabilityKinds) {
      const value = point.liabilities[kind] ?? 0;
      liabilitiesByKind[kind] = value;
      liabilitiesTotal += value;
    }

    return {
      date: point.date,
      assetsByKind,
      assetsTotal,
      liabilitiesByKind,
      liabilitiesTotal,
      netWorth: assetsTotal + liabilitiesTotal,
    };
  });

/**
 * Mean of the displayed per-point liabilities as a positive "owed" magnitude.
 * A non-negative mean (paid-off or overpaid on average) reads as owing nothing.
 */
export const averageOwedLiabilities = ({ points }: { points: NetWorthDisplayPoint[] }): number => {
  if (points.length === 0) return 0;
  const mean = points.reduce((sum, point) => sum + point.liabilitiesTotal, 0) / points.length;
  return mean < 0 ? -mean : 0;
};

// Owed totals below this share of the positive extreme are invisible on a shared
// linear scale, so the chart switches to a zoomed sub-scale for the owed region.
const ASYMMETRIC_OWED_SHARE_THRESHOLD = 0.1;

interface LiabilityScale {
  /** Render the owed region on its own zoomed sub-scale instead of the shared one. */
  asymmetric: boolean;
  /** Largest of assets, net worth and positive liability sums across the series. */
  maxPositive: number;
  /** Largest owed magnitude (most negative displayed liabilities total), as a positive number. */
  maxOwed: number;
}

/**
 * Decides whether the chart may zoom the owed region. `zoomEnabled` is the user's
 * setting — off means never zoom. Even when on, zooming is only honest while the
 * only thing hanging below the baseline is liabilities: a negative net worth,
 * negative assets total, or a single overdrawn asset kind (a below-baseline
 * segment that isn't a liability) all need the shared scale, since the zoomed owed
 * sub-scale would either misrepresent them or push them off the plot.
 */
export const computeLiabilityScale = ({
  points,
  zoomEnabled = true,
}: {
  points: NetWorthDisplayPoint[];
  zoomEnabled?: boolean;
}): LiabilityScale => {
  let maxPositive = 0;
  let maxOwed = 0;
  let onlyLiabilitiesBelowBaseline = true;

  for (const point of points) {
    maxPositive = Math.max(maxPositive, point.assetsTotal, point.netWorth, point.liabilitiesTotal);
    if (point.liabilitiesTotal < 0) maxOwed = Math.max(maxOwed, -point.liabilitiesTotal);
    const hasNegativeAssetKind = Object.values(point.assetsByKind).some((value) => value < 0);
    if (point.netWorth < 0 || point.assetsTotal < 0 || hasNegativeAssetKind) onlyLiabilitiesBelowBaseline = false;
  }

  return {
    asymmetric:
      zoomEnabled &&
      maxOwed > 0 &&
      maxOwed < ASYMMETRIC_OWED_SHARE_THRESHOLD * maxPositive &&
      onlyLiabilitiesBelowBaseline,
    maxPositive,
    maxOwed,
  };
};

/**
 * Last minus first displayed net worth. The percentage is null when the first
 * point is zero — a ratio against nothing reads as noise, not a change.
 */
export const computePeriodChange = ({
  points,
}: {
  points: NetWorthDisplayPoint[];
}): { amount: number; pct: number | null } => {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return { amount: 0, pct: null };

  const amount = last.netWorth - first.netWorth;
  const pct = first.netWorth !== 0 ? (amount / Math.abs(first.netWorth)) * 100 : null;
  return { amount, pct };
};

// Below one year, annualizing extrapolates a partial period into a full-year rate,
// which overstates the trend — so a compound annual growth rate is only reported
// for ranges of at least a year.
const MIN_YEARS_FOR_ANNUALIZED = 1;
const DAYS_PER_YEAR = 365.25;

/**
 * Compound annual growth rate of net worth across the displayed range, as a
 * percentage. Null when it can't be expressed as compounding growth: a
 * non-positive endpoint (net worth that started or ended at/below zero has no
 * meaningful ratio) or a span shorter than a year.
 */
export const annualizedGrowthPct = ({ points }: { points: NetWorthDisplayPoint[] }): number | null => {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last || first === last) return null;
  if (first.netWorth <= 0 || last.netWorth <= 0) return null;

  const years = differenceInCalendarDays(parseISO(last.date), parseISO(first.date)) / DAYS_PER_YEAR;
  if (years < MIN_YEARS_FOR_ANNUALIZED) return null;

  return (Math.pow(last.netWorth / first.netWorth, 1 / years) - 1) * 100;
};

/** Calendar buckets the range spans at a granularity — mirrors how the API buckets. */
export const countBuckets = ({
  from,
  to,
  granularity,
}: {
  from: Date;
  to: Date;
  granularity: NetWorthHistoryGranularity;
}): number => {
  switch (granularity) {
    case 'weekly':
      return differenceInCalendarISOWeeks(to, from) + 1;
    case 'monthly':
      return differenceInCalendarMonths(to, from) + 1;
    case 'quarterly':
      return differenceInCalendarQuarters(to, from) + 1;
    case 'yearly':
      return differenceInCalendarYears(to, from) + 1;
  }
};

/**
 * Default granularity for a range: fine enough to show shape, coarse enough that
 * every threshold stays comfortably under the backend's bucket cap.
 */
export const autoGranularity = ({ from, to }: { from: Date; to: Date }): NetWorthHistoryGranularity => {
  const days = differenceInCalendarDays(to, from) + 1;
  if (days <= 370) return 'weekly';
  if (days <= 1850) return 'monthly';
  return 'quarterly';
};

/** Granularities the current range would push past the backend's bucket cap. */
export const disabledGranularities = ({ from, to }: { from: Date; to: Date }): NetWorthHistoryGranularity[] =>
  NET_WORTH_HISTORY_GRANULARITIES.filter(
    (granularity) => countBuckets({ from, to, granularity }) > MAX_NET_WORTH_HISTORY_BUCKETS,
  );
