import type { PivotGranularity } from '@bt/shared/types';
import { format, getQuarter, getYear, startOfWeek } from 'date-fns';

import { PeriodBucket, generatePeriodBuckets } from '../utils';

// Weeks start on Monday to match the cash-flow report and ISO conventions.
const WEEK_OPTS = { weekStartsOn: 1 } as const;

/**
 * Generates the time buckets (one per pivot column) for a granularity over [from, to]. Bucketing
 * and edge clamping are shared with the cash-flow report via `generatePeriodBuckets`.
 */
export const generatePivotBuckets = ({
  from,
  to,
  granularity,
}: {
  from: string;
  to: string;
  granularity: PivotGranularity;
}): PeriodBucket[] => generatePeriodBuckets({ from, to, granularity });

/**
 * Stable, range-unique column key. The year is always present so keys never collide across
 * a multi-year range (e.g. Q1 2024 vs Q1 2025). Because edge clamping only ever moves the
 * first bucket's start forward within its own period, deriving the key from `periodStart` is
 * safe.
 */
export const getBucketKey = ({
  periodStart,
  granularity,
}: {
  periodStart: Date;
  granularity: PivotGranularity;
}): string => {
  switch (granularity) {
    case 'yearly':
      return format(periodStart, 'yyyy');
    case 'quarterly':
      return `${getYear(periodStart)}-Q${getQuarter(periodStart)}`;
    case 'monthly':
      return format(periodStart, 'yyyy-MM');
    case 'weekly':
      return format(startOfWeek(periodStart, WEEK_OPTS), 'yyyy-MM-dd');
  }
};

/**
 * Non-localized default label for a column. The client may reformat/localize from the
 * column's `periodStart` + granularity.
 */
export const getBucketLabel = ({
  periodStart,
  granularity,
}: {
  periodStart: Date;
  granularity: PivotGranularity;
}): string => {
  switch (granularity) {
    case 'yearly':
      return format(periodStart, 'yyyy');
    case 'quarterly':
      return `Q${getQuarter(periodStart)} ${getYear(periodStart)}`;
    case 'monthly':
      return format(periodStart, 'MMM yyyy');
    case 'weekly':
      return `Wk of ${format(startOfWeek(periodStart, WEEK_OPTS), 'yyyy-MM-dd')}`;
  }
};
