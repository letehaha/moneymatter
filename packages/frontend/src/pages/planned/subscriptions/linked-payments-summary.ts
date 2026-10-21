import { SUBSCRIPTION_FREQUENCIES } from '@bt/shared/types';
import { addDays, differenceInCalendarDays, format } from 'date-fns';

/** Fallback bar height when every refAmount is zero, so the chart still renders bars. */
const MIN_BAR_HEIGHT_PCT = 8;

/**
 * Bars scale across the min–max refAmount range (sparkline-style), not from a zero
 * baseline: recurring payments cluster tightly, and a zero baseline renders them as a
 * flat wall that hides the drift the chart exists to show.
 */
const BAR_RANGE_FLOOR_PCT = 30;

/** Below this, a first-vs-latest comparison describes noise rather than a trend. */
const MIN_PAYMENTS_FOR_DRIFT = 3;

/** Below this, the bars are decoration rather than insight, so no chart is built. */
const MIN_PAYMENTS_FOR_CHART = 4;

/** A long pause would otherwise flood the chart with empty slots. */
const MAX_GAP_SLOTS = 3;

/**
 * Only the most recent payments are charted. Bars have a min-width and no
 * horizontal scroll, so an unbounded history (e.g. a weekly subscription)
 * would overflow the card on narrow containers.
 */
const MAX_CHART_PAYMENTS = 24;

/** Average calendar length of one billing period, used to count skipped periods. */
const FREQUENCY_STEP_DAYS: Record<SUBSCRIPTION_FREQUENCIES, number> = {
  [SUBSCRIPTION_FREQUENCIES.weekly]: 7,
  [SUBSCRIPTION_FREQUENCIES.biweekly]: 14,
  [SUBSCRIPTION_FREQUENCIES.monthly]: 30.44,
  [SUBSCRIPTION_FREQUENCIES.quarterly]: 91.3,
  [SUBSCRIPTION_FREQUENCIES.semiAnnual]: 182.6,
  [SUBSCRIPTION_FREQUENCIES.annual]: 365.25,
};

/** Shape the summary reads off a linked transaction; callers keep their own richer type. */
export interface LinkedPaymentLike {
  id: string;
  amount: number;
  /** `null` while a custom currency has no rate: the payment counts as 0 in base-currency figures. */
  refAmount: number | null;
  currencyCode: string;
  refCurrencyCode: string;
  time: Date | string;
  isPlanned: boolean;
}

export interface LinkedPaymentsCurrencyTotal {
  currencyCode: string;
  total: number;
}

interface LinkedPaymentsYearGroup<T> {
  year: number;
  /** The year's linked rows, planned ones included — this is what the ledger lists. */
  payments: T[];
  /** Sum of refAmount — the year's single comparable total in the base currency. */
  refTotal: number;
  /** True when at least one payment was booked in a non-base currency. */
  isConverted: boolean;
  /** Native per-currency breakdown, dominant currency first. */
  totalsByCurrency: LinkedPaymentsCurrencyTotal[];
}

export interface LinkedPaymentsChartBar {
  kind: 'payment';
  id: string;
  heightPct: number;
  monthLabel: string;
  amount: number;
  currencyCode: string;
  refAmount: number;
  refCurrencyCode: string;
  isLatest: boolean;
}

export interface LinkedPaymentsChartGap {
  kind: 'gap';
  id: string;
  missedCount: number;
  slotCount: number;
  rangeLabel: string;
}

export type LinkedPaymentsChartSlot = LinkedPaymentsChartBar | LinkedPaymentsChartGap;

interface LinkedPaymentsDrift {
  percent: number;
  direction: 'up' | 'down';
  firstPaymentTime: Date;
}

interface LinkedPaymentsAverage {
  amount: number;
  currencyCode: string;
}

/**
 * Aggregates sum refAmount: it's the only denomination in which a multi-currency
 * history adds up to one number, on the same basis budgets use. Native amounts stay
 * available per-currency in `totalsByCurrency` for secondary display.
 */
interface LinkedPaymentsStats {
  /** Sum of refAmount across all payments, in the base currency. */
  refTotal: number;
  /** Base currency code; null only when nothing is linked. */
  refCurrencyCode: string | null;
  /** True when at least one payment was booked in a non-base currency. */
  isConverted: boolean;
  /** Native per-currency breakdown, dominant currency first. */
  totalsByCurrency: LinkedPaymentsCurrencyTotal[];
  /** Mean refAmount over ALL payments, so total ÷ count reconciles with `refTotal`. */
  refAverage: number | null;
  /**
   * Mean native amount, present only when every payment shares one native currency —
   * the sole case where a native mean is well-defined. Carries the provider's sticker
   * price when that currency differs from the base.
   */
  nativeAverage: LinkedPaymentsAverage | null;
  lastPaymentTime: Date | null;
}

interface LinkedPaymentsSummary<T> {
  /** Every linked row, planned ones included — this is what the ledger lists. */
  payments: T[];
  yearGroups: LinkedPaymentsYearGroup<T>[];
  stats: LinkedPaymentsStats;
  chart: LinkedPaymentsChartSlot[] | null;
  drift: LinkedPaymentsDrift | null;
}

const toDate = ({ time }: { time: Date | string }): Date => (time instanceof Date ? time : new Date(time));

/** A planned row is a commitment, not spend, so no amount aggregate may count it. */
const settledOnly = <T extends LinkedPaymentLike>({ payments }: { payments: T[] }): T[] =>
  payments.filter((payment) => !payment.isPlanned);

const sumRefAmounts = <T extends LinkedPaymentLike>({ payments }: { payments: T[] }): number =>
  payments.reduce((sum, payment) => sum + (payment.refAmount ?? 0), 0);

const hasConvertedPayment = <T extends LinkedPaymentLike>({ payments }: { payments: T[] }): boolean =>
  payments.some((payment) => payment.currencyCode !== payment.refCurrencyCode);

/** Dominant currency first: the code the most payments were booked in leads the list. */
const sumByCurrency = <T extends LinkedPaymentLike>({ payments }: { payments: T[] }): LinkedPaymentsCurrencyTotal[] => {
  const buckets = new Map<string, { total: number; count: number }>();

  for (const payment of payments) {
    const bucket = buckets.get(payment.currencyCode) ?? { total: 0, count: 0 };
    bucket.total += payment.amount;
    bucket.count += 1;
    buckets.set(payment.currencyCode, bucket);
  }

  return [...buckets.entries()]
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([currencyCode, { total }]) => ({ currencyCode, total }));
};

const buildDrift = <T extends LinkedPaymentLike>({
  first,
  latest,
  paymentsCount,
}: {
  first: T | undefined;
  latest: T | undefined;
  paymentsCount: number;
}): LinkedPaymentsDrift | null => {
  if (!first || !latest || paymentsCount < MIN_PAYMENTS_FOR_DRIFT || !first.refAmount) return null;
  // A subscription rebilled in another currency changed plan, not price.
  if (first.currencyCode !== latest.currencyCode) return null;
  // Drift compares base-currency amounts, which a payment without a rate does not have.
  if (latest.refAmount === null) return null;

  const percent = Math.round(((latest.refAmount - first.refAmount) / first.refAmount) * 100);
  if (percent === 0) return null;

  return {
    percent: Math.abs(percent),
    direction: percent > 0 ? 'up' : 'down',
    firstPaymentTime: toDate({ time: first.time }),
  };
};

/**
 * Rounding absorbs real-world jitter: paying a few days early or late still lands on
 * the same period count, so only a genuinely skipped period produces a gap.
 */
const buildGap = <T extends LinkedPaymentLike>({
  previous,
  current,
  stepDays,
}: {
  previous: T;
  current: T;
  stepDays: number;
}): LinkedPaymentsChartGap | null => {
  const previousTime = toDate({ time: previous.time });
  const diffInDays = differenceInCalendarDays(toDate({ time: current.time }), previousTime);
  const missedCount = Math.max(0, Math.round(diffInDays / stepDays) - 1);
  if (missedCount < 1) return null;

  const firstMissedLabel = format(addDays(previousTime, Math.round(stepDays)), 'MMM yy');
  const lastMissedLabel = format(addDays(previousTime, Math.round(stepDays * missedCount)), 'MMM yy');

  return {
    kind: 'gap',
    id: `gap-${previous.id}-${current.id}`,
    missedCount,
    slotCount: Math.min(missedCount, MAX_GAP_SLOTS),
    rangeLabel: firstMissedLabel === lastMissedLabel ? firstMissedLabel : `${firstMissedLabel} – ${lastMissedLabel}`,
  };
};

/**
 * Everything the linked-payments UI renders, derived in one pass: the ledger
 * (newest-first, grouped by year), the headline stats, the amount chart and the
 * price drift. Totals, averages, chart heights and drift all compare `refAmount`,
 * so payments booked in different currencies stay comparable. The ledger lists
 * planned rows; every aggregate is computed over the settled ones only.
 */
export const buildLinkedPaymentsSummary = <T extends LinkedPaymentLike>({
  transactions,
  frequency,
}: {
  transactions: T[];
  frequency: SUBSCRIPTION_FREQUENCIES;
}): LinkedPaymentsSummary<T> => {
  const payments = [...transactions].sort(
    (a, b) => toDate({ time: b.time }).getTime() - toDate({ time: a.time }).getTime(),
  );
  const settled = settledOnly({ payments });
  const oldestFirst = [...settled].reverse();

  const yearBuckets = new Map<number, T[]>();
  for (const payment of payments) {
    const year = toDate({ time: payment.time }).getFullYear();
    const bucket = yearBuckets.get(year);
    if (bucket) {
      bucket.push(payment);
    } else {
      yearBuckets.set(year, [payment]);
    }
  }

  const yearGroups = [...yearBuckets.entries()]
    .sort(([a], [b]) => b - a)
    .map(([year, yearPayments]) => {
      const yearSettled = settledOnly({ payments: yearPayments });

      return {
        year,
        payments: yearPayments,
        refTotal: sumRefAmounts({ payments: yearSettled }),
        isConverted: hasConvertedPayment({ payments: yearSettled }),
        totalsByCurrency: sumByCurrency({ payments: yearSettled }),
      };
    });

  const latest = settled[0];

  const buildChart = (): LinkedPaymentsChartSlot[] | null => {
    if (oldestFirst.length < MIN_PAYMENTS_FOR_CHART) return null;

    const charted = oldestFirst.slice(-MAX_CHART_PAYMENTS);

    // Heights scale within the charted window only, so an off-window outlier
    // can't flatten the visible bars.
    const refAmounts = charted.map((payment) => payment.refAmount ?? 0);
    const maxRefAmount = Math.max(0, ...refAmounts);
    const minRefAmount = Math.min(...refAmounts);
    const refRange = maxRefAmount - minRefAmount;

    const barHeightPct = ({ refAmount }: { refAmount: number }): number => {
      if (maxRefAmount === 0) return MIN_BAR_HEIGHT_PCT;
      if (refRange === 0) return 100;
      return BAR_RANGE_FLOOR_PCT + ((refAmount - minRefAmount) / refRange) * (100 - BAR_RANGE_FLOOR_PCT);
    };

    const stepDays = FREQUENCY_STEP_DAYS[frequency];

    return charted.flatMap((payment, index) => {
      const previous = charted[index - 1];
      const gap = previous ? buildGap({ previous, current: payment, stepDays }) : null;

      const bar: LinkedPaymentsChartBar = {
        kind: 'payment',
        id: payment.id,
        heightPct: barHeightPct({ refAmount: payment.refAmount ?? 0 }),
        monthLabel: format(toDate({ time: payment.time }), 'MMM yy'),
        amount: payment.amount,
        currencyCode: payment.currencyCode,
        refAmount: payment.refAmount ?? 0,
        refCurrencyCode: payment.refCurrencyCode,
        isLatest: index === charted.length - 1,
      };

      return gap ? [gap, bar] : [bar];
    });
  };

  const totalsByCurrency = sumByCurrency({ payments: settled });
  const refTotal = sumRefAmounts({ payments: settled });
  const singleNativeCurrency = totalsByCurrency.length === 1 ? totalsByCurrency[0] : undefined;

  return {
    payments,
    yearGroups,
    stats: {
      refTotal,
      refCurrencyCode: latest ? latest.refCurrencyCode : null,
      isConverted: hasConvertedPayment({ payments: settled }),
      totalsByCurrency,
      refAverage: settled.length ? refTotal / settled.length : null,
      nativeAverage: singleNativeCurrency
        ? { amount: singleNativeCurrency.total / settled.length, currencyCode: singleNativeCurrency.currencyCode }
        : null,
      lastPaymentTime: latest ? toDate({ time: latest.time }) : null,
    },
    chart: buildChart(),
    drift: buildDrift({ first: oldestFirst[0], latest, paymentsCount: settled.length }),
  };
};
