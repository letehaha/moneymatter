import type {
  GoalAccountHistory,
  GoalDisplayStatus,
  GoalInsights,
  GoalMathInput,
  GoalModel,
  GoalProgress,
  GoalProgressStatus,
  GoalScheduleOffset,
} from '../types/goals';

/**
 * Goal progress math, shared so the server's numbers and the client's What-if re-run agree.
 * Every function takes and returns decimals; the arithmetic runs on integer cents so a
 * division such as `ceil(1.10 / 0.10)` can't land on 12 through float noise.
 */

export const DAYS_PER_MONTH = 30.44;
const PACE_WINDOW_MONTHS = 6;
export const MIN_HISTORY_MONTHS = 3;
export const FULL_SHARE = 100;

const MS_PER_DAY = 86_400_000;

const toCents = (amount: number) => Math.round(amount * 100);
const fromCents = (cents: number) => Math.round(cents) / 100;

/** Percent shares carry two decimals. */
export const roundShare = (value: number) => fromCents(toCents(value));

/** Base-currency decimal to the goal currency, rounded to cents. */
export function toGoalCurrency(params: { amount: number; rateToBase: number }): number;
export function toGoalCurrency(params: { amount: number | null; rateToBase: number }): number | null;
export function toGoalCurrency({ amount, rateToBase }: { amount: number | null; rateToBase: number }) {
  return amount === null ? null : fromCents(toCents(amount) / rateToBase);
}

export const median = ({ values }: { values: number[] }): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/** Whole days from `from` to `to`, both 'yyyy-MM-dd'; negative when `to` is earlier. */
const daysBetween = ({ from, to }: { from: string; to: string }): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / MS_PER_DAY);

interface AccountValueParams {
  balance: number;
  creditLimit: number;
  sharePercent: number;
}

/** share × max(0, balance − credit limit): a negative balance never reduces progress. Unrounded cents. */
const accountValueCents = ({ balance, creditLimit, sharePercent }: AccountValueParams): number =>
  (Math.max(0, toCents(balance) - toCents(creditLimit)) * sharePercent) / FULL_SHARE;

export const accountGoalValue = (params: AccountValueParams): number => fromCents(accountValueCents(params));

const goalValueCents = ({
  accounts,
  balanceOf,
}: {
  accounts: GoalAccountHistory[];
  balanceOf: (account: GoalAccountHistory) => number;
}): number =>
  Math.round(
    accounts.reduce(
      (sum, account) =>
        sum +
        accountValueCents({
          balance: balanceOf(account),
          creditLimit: account.creditLimit,
          sharePercent: account.sharePercent,
        }),
      0,
    ),
  );

export const currentGoalValue = ({ accounts }: { accounts: GoalAccountHistory[] }): number =>
  fromCents(goalValueCents({ accounts, balanceOf: (account) => account.currentBalance }));

const goalMonthEndValues = ({ months, accounts }: Pick<GoalMathInput, 'months' | 'accounts'>): number[] =>
  months.map((_, index) =>
    fromCents(goalValueCents({ accounts, balanceOf: (account) => account.monthEndBalances[index] ?? 0 })),
  );

/**
 * Median monthly change over the last `PACE_WINDOW_MONTHS` full months. The window starts at
 * the latest first-data date among the accounts: before it, an account's series is its
 * earliest balance carried back, which would read as a flat, zero-pace month.
 */
const historicalPace = ({
  today,
  months,
  accounts,
  monthEndValues,
}: Pick<GoalMathInput, 'today' | 'months' | 'accounts'> & { monthEndValues: number[] }): {
  pace: number | null;
  historyMonths: number;
} => {
  const windowStart = accounts.reduce<string | null>(
    (latest, { firstDataDate }) => (firstDataDate && (!latest || firstDataDate > latest) ? firstDataDate : latest),
    null,
  );
  const points = months
    .map((date, index) => ({ date, cents: toCents(monthEndValues[index] ?? 0) }))
    .filter(({ date }) => date < today)
    .slice(-(PACE_WINDOW_MONTHS + 1))
    .filter(({ date }) => !windowStart || date >= windowStart);

  const deltas = points.slice(1).map((point, index) => point.cents - points[index]!.cents);
  if (deltas.length < MIN_HISTORY_MONTHS) return { pace: null, historyMonths: deltas.length };

  return { pace: fromCents(median({ values: deltas })!), historyMonths: deltas.length };
};

/** Whole months until `remaining` is covered at `pace`; null when pace doesn't move toward it. */
export const etaMonths = ({ remaining, pace }: { remaining: number; pace: number | null }): number | null => {
  const remainingCents = toCents(remaining);
  if (remainingCents <= 0) return 0;
  if (pace === null || toCents(pace) <= 0) return null;
  return Math.ceil(remainingCents / toCents(pace));
};

/**
 * Day precision rather than whole calendar months, so the ask doesn't jump at each month
 * boundary. Under one month left, or past the date, the whole remainder is due.
 */
export const neededMonthly = ({
  remaining,
  today,
  targetDate,
}: {
  remaining: number;
  today: string;
  targetDate: string | null;
}): { neededMonthly: number | null; daysLeft: number | null } => {
  if (!targetDate) return { neededMonthly: null, daysLeft: null };

  const daysLeft = daysBetween({ from: today, to: targetDate });
  const remainingCents = Math.max(0, toCents(remaining));
  const monthsLeft = Math.max(0, daysLeft) / DAYS_PER_MONTH;

  return { neededMonthly: fromCents(monthsLeft >= 1 ? remainingCents / monthsLeft : remainingCents), daysLeft };
};

/**
 * No tolerance band: early means reaching the target at least a month before the date.
 * Compares the whole-month `etaMonths` that is displayed, so status and ETA never disagree.
 */
export const scheduleOffset = ({
  etaMonths,
  daysLeft,
}: {
  etaMonths: number;
  daysLeft: number;
}): GoalScheduleOffset => {
  const monthsLeft = daysLeft / DAYS_PER_MONTH;
  if (etaMonths <= monthsLeft - 1) return { kind: 'early', months: Math.floor(monthsLeft - etaMonths) };
  if (etaMonths <= monthsLeft) return { kind: 'onTime', months: 0 };
  return { kind: 'late', months: Math.max(1, Math.ceil(etaMonths - monthsLeft)) };
};

/** 'yyyy-MM-dd' `etaMonths` after `today`; a day past the month's end clamps to its last day. */
export const etaDate = ({ today, etaMonths }: { today: string; etaMonths: number }): string => {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(year, month + etaMonths, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + etaMonths, Math.min(day, lastDay))).toISOString().slice(0, 10);
};

const STATUS_BY_OFFSET: Record<GoalScheduleOffset['kind'], GoalProgressStatus> = {
  early: 'ahead',
  onTime: 'on_track',
  late: 'behind',
};

const progressStatus = ({
  hasAccounts,
  remaining,
  targetDate,
  daysLeft,
  pace,
  eta,
}: {
  hasAccounts: boolean;
  remaining: number;
  targetDate: string | null;
  daysLeft: number | null;
  pace: number | null;
  eta: number | null;
}): GoalProgressStatus => {
  if (!hasAccounts) return 'no_accounts';
  if (toCents(remaining) <= 0) return 'reached';
  if (daysLeft !== null && daysLeft < 0) return 'overdue';
  if (!targetDate || daysLeft === null) return 'no_date';
  if (pace === null) return 'insufficient_history';
  if (eta === null) return 'behind';
  return STATUS_BY_OFFSET[scheduleOffset({ etaMonths: eta, daysLeft }).kind];
};

/** A set `achievedAt` reads as reached, so a latched goal that dipped below target still shows reached. */
export const goalDisplayStatus = ({
  status,
  achievedAt,
  insights,
}: Pick<GoalModel, 'status' | 'achievedAt'> & { insights: Pick<GoalInsights, 'status'> | null }): GoalDisplayStatus => {
  if (status === 'archived') return 'archived';
  if (achievedAt) return 'reached';
  if (!insights) return 'no_rate';
  if (insights.status === 'reached') return 'reached';
  if (status === 'paused') return 'paused';
  return insights.status;
};

/**
 * Base-currency monthly need for feasibility. Null when the date is under a month away or past:
 * the whole remainder is due then, which is not a monthly need.
 */
export const goalMonthlyDemand = (
  insights: Pick<GoalInsights, 'daysLeft' | 'neededMonthly'> & { input: Pick<GoalMathInput, 'plannedMonthly'> },
): number | null => {
  if (insights.daysLeft !== null && insights.daysLeft < DAYS_PER_MONTH) return null;
  return Math.max(insights.neededMonthly ?? 0, insights.input.plannedMonthly ?? 0);
};

export const computeGoalProgress = (input: GoalMathInput): GoalProgress => {
  const { today, months, accounts, targetAmount, targetDate, plannedMonthly } = input;

  const currentValue = currentGoalValue({ accounts });
  const remaining = fromCents(Math.max(0, toCents(targetAmount) - toCents(currentValue)));
  const monthEndValues = goalMonthEndValues({ months, accounts });
  const history = historicalPace({ today, months, accounts, monthEndValues });
  const pace = plannedMonthly ?? history.pace;
  const needed = neededMonthly({ remaining, today, targetDate });
  const eta = etaMonths({ remaining, pace });

  return {
    status: progressStatus({
      hasAccounts: accounts.length > 0,
      remaining,
      targetDate,
      daysLeft: needed.daysLeft,
      pace,
      eta,
    }),
    currentValue,
    remaining,
    monthEndValues,
    historicalPace: history.pace,
    historyMonths: history.historyMonths,
    pace,
    etaMonths: eta,
    neededMonthly: needed.neededMonthly,
    daysLeft: needed.daysLeft,
  };
};
