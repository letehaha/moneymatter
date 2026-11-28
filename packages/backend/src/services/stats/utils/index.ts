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
  getDate,
  isBefore,
  max,
  min,
  setDate,
  startOfDay,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
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
  const where: Partial<Record<ColumnName, Record<symbol, string[] | string>>> = {};

  if (from && to) {
    where[columnName] = {
      [Op.between]: [from, to],
    };
  } else if (from) {
    where[columnName] = {
      [Op.gte]: from,
    };
  } else if (to) {
    where[columnName] = {
      [Op.lte]: to,
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
  daily: { startOf: startOfDay, endOf: endOfDay, advance: (date) => addDays(date, 1) },
};

// A pay month runs from `payday` to the day before the next one; payday 1 is the calendar month.
const getPayMonthSpec = (payday: number): GranularitySpec => ({
  startOf: (date) => startOfDay(setDate(getDate(date) >= payday ? date : subMonths(date, 1), payday)),
  endOf: (periodStart) => endOfDay(subDays(addMonths(periodStart, 1), 1)),
  advance: (date) => addMonths(date, 1),
});

/**
 * The calendar date (`yyyy-mm-dd`) of `value` in `timezone`, as a UTC-midnight Date.
 * A plain `yyyy-mm-dd` string is already a local calendar date, so it is used as-is;
 * a timestamp is converted to the date the user saw in their own timezone. Bucket
 * starts/ends are therefore local calendar dates, represented as UTC-midnight dates
 * the same way the rest of this file represents calendar dates, instead of the UTC
 * date of the instant (which moves a 02:22 transaction on the 1st into the previous
 * month for a positive-offset timezone).
 */
function zonedCalendarDate(value: string | Date, timezone: string): Date {
  const dateString =
    typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? value
      : new Intl.DateTimeFormat('en-CA', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(value));
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Generates the [from, to] time buckets (one per report column) for a granularity. Both edges are
 * clamped to the requested range exactly — the first bucket starts at `from`, the last ends at
 * `endOfDay(to)` — so a transaction on the boundary day is still counted. Shared by the cash-flow,
 * pivot and net-worth-history reports.
 *
 * When `timezone` is given, bucket boundaries are the user's local calendar dates: a transaction
 * at 02:22 on the 1st of the month in GMT+3 belongs to that month, not to the previous one.
 * Without a timezone the previous UTC behaviour is unchanged.
 */
export const generatePeriodBuckets = ({
  from,
  to,
  granularity,
  payday = 1,
  timezone,
}: {
  from: string;
  to: string;
  granularity: StatsGranularity;
  /** Day of month (1-28) `monthly` buckets start on. */
  payday?: number;
  /** IANA timezone of the requesting user, e.g. `Europe/Kyiv`. */
  timezone?: string;
}): PeriodBucket[] => {
  const spec = granularity === 'monthly' && payday !== 1 ? getPayMonthSpec(payday) : GRANULARITY_SPECS[granularity];
  const buckets: PeriodBucket[] = [];
  const startDate = timezone ? zonedCalendarDate(from, timezone) : new Date(from);
  const endDate = endOfDay(timezone ? zonedCalendarDate(to, timezone) : new Date(to));
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
 * With `timezone`, the transaction is placed by its local calendar date, so a transaction
 * at 02:22 on the 1st in GMT+3 lands in that month's bucket even though its UTC instant
 * is still on the last day of the previous month.
 */
export const findBucketIndex = ({
  transactionTime,
  buckets,
  timezone,
}: {
  transactionTime: Date;
  buckets: PeriodBucket[];
  /** IANA timezone of the requesting user, e.g. `Europe/Kyiv`. */
  timezone?: string;
}): number => {
  const time = (timezone ? zonedCalendarDate(transactionTime, timezone) : transactionTime).getTime();
  if (Number.isNaN(time)) {
    return -1;
  }
  return buckets.findIndex((bucket) => time >= bucket.periodStart.getTime() && time <= bucket.periodEnd.getTime());
};
