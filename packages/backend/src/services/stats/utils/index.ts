import type { CashFlowGranularity, NetWorthHistoryGranularity, PivotGranularity } from '@bt/shared/types';
import {
  addDays,
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  endOfDay,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  isBefore,
  max,
  min,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { Op } from 'sequelize';

export { getScopedEnabledPortfolios } from './scoped-portfolios';
export { fetchSavingsTransactions } from './savings-transactions';

type ColumnName = 'time' | 'date';
interface DateQuery {
  // yyyy-mm-dd
  from?: string;
  // yyyy-mm-dd
  to?: string;
  columnName: ColumnName;
}

export const getWhereConditionForTime = ({ from, to, columnName }: DateQuery) => {
  const where: Partial<Record<ColumnName, Record<symbol, Date[] | Date>>> = {};

  if (from && to) {
    where[columnName] = {
      [Op.between]: [new Date(from), endOfDay(new Date(to))],
    };
  } else if (from) {
    where[columnName] = {
      [Op.gte]: new Date(from),
    };
  } else if (to) {
    where[columnName] = {
      [Op.lte]: new Date(to),
    };
  }

  return where;
};

/**
 * Minimal time-bucket shape shared by the stats reports. The per-report bucket generators
 * (cash-flow, pivot) produce richer buckets that structurally include these two fields.
 */
export interface PeriodBucket {
  periodStart: Date;
  periodEnd: Date;
}

// Weeks start on Monday (ISO), matching every stats report.
const WEEK_OPTS = { weekStartsOn: 1 } as const;

interface GranularitySpec {
  /** Snap a date back to the start of its period. */
  startOf: (date: Date) => Date;
  /** End of the period that begins at `periodStart`. */
  endOf: (periodStart: Date) => Date;
  /** Step to the next period's start. */
  advance: (periodStart: Date) => Date;
}

type StatsGranularity = PivotGranularity | CashFlowGranularity | NetWorthHistoryGranularity;

// Every granularity used by any stats report. `biweekly` (cash-flow only) is a 2-week window, so
// its period end is the day before the start of the week two ahead.
const GRANULARITY_SPECS: Record<StatsGranularity, GranularitySpec> = {
  yearly: { startOf: startOfYear, endOf: endOfYear, advance: (date) => addYears(date, 1) },
  quarterly: { startOf: startOfQuarter, endOf: endOfQuarter, advance: (date) => addQuarters(date, 1) },
  monthly: { startOf: startOfMonth, endOf: endOfMonth, advance: (date) => addMonths(date, 1) },
  weekly: {
    startOf: (date) => startOfWeek(date, WEEK_OPTS),
    endOf: (date) => endOfWeek(date, WEEK_OPTS),
    advance: (date) => addWeeks(date, 1),
  },
  biweekly: {
    startOf: (date) => startOfWeek(date, WEEK_OPTS),
    endOf: (date) => endOfDay(addDays(addWeeks(date, 2), -1)),
    advance: (date) => addWeeks(date, 2),
  },
};

/**
 * Generates the [from, to] time buckets (one per report column) for a granularity. Both edges are
 * clamped to the requested range exactly — the first bucket starts at `from`, the last ends at
 * `endOfDay(to)` — so a transaction on the boundary day is still counted. Shared by the cash-flow,
 * pivot and net-worth-history reports.
 */
export const generatePeriodBuckets = ({
  from,
  to,
  granularity,
}: {
  from: string;
  to: string;
  granularity: StatsGranularity;
}): PeriodBucket[] => {
  const spec = GRANULARITY_SPECS[granularity];
  const buckets: PeriodBucket[] = [];
  const startDate = new Date(from);
  const endDate = endOfDay(new Date(to));

  const withinRange = (date: Date): boolean => isBefore(date, endDate) || date.getTime() === endDate.getTime();

  let currentStart = spec.startOf(startDate);
  while (withinRange(currentStart)) {
    buckets.push({ periodStart: max([currentStart, startDate]), periodEnd: min([spec.endOf(currentStart), endDate]) });
    currentStart = spec.advance(currentStart);
  }

  return buckets;
};

/**
 * Index of the bucket a transaction time falls into, or -1 when it is outside every bucket.
 * Both edges are inclusive, so a time exactly on a `periodStart` or `periodEnd` counts.
 */
export const findBucketIndex = ({
  transactionTime,
  buckets,
}: {
  transactionTime: Date;
  buckets: PeriodBucket[];
}): number => {
  const txTime = transactionTime.getTime();
  return buckets.findIndex((bucket) => txTime >= bucket.periodStart.getTime() && txTime <= bucket.periodEnd.getTime());
};
