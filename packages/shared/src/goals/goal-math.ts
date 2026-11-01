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

type AccountValueParams = Pick<GoalAccountHistory, 'sharePercent' | 'fixedAmount' | 'fixedAhead' | 'fixedOthers'> & {
  balance: number;
  creditLimit: number;
};

/**
 * Of the balance above the credit limit, a fixed amount takes what the fixed amounts ahead of it
 * leave, up to itself; a share takes its percent of what all fixed amounts leave. A negative
 * balance never reduces progress. Unrounded cents.
 */
const accountValueCents = ({
  balance,
  creditLimit,
  sharePercent,
  fixedAmount,
  fixedAhead,
  fixedOthers,
}: AccountValueParams): number => {
  const available = Math.max(0, toCents(balance) - toCents(creditLimit));
  if (fixedAmount !== null) return Math.min(toCents(fixedAmount), Math.max(0, available - toCents(fixedAhead)));
  return (Math.max(0, available - toCents(fixedOthers)) * (sharePercent ?? 0)) / FULL_SHARE;
};

export const accountGoalValue = (params: AccountValueParams): number => fromCents(accountValueCents(params));

const goalValueCents = ({
  accounts,
  balanceOf,
}: {
  accounts: GoalAccountHistory[];
  balanceOf: (account: GoalAccountHistory) => number;
}): number =>
  Math.round(
    accounts.reduce((sum, account) => sum + accountValueCents({ ...account, balance: balanceOf(account) }), 0),
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
  const averageMonthsLeft = Math.max(0, daysLeft) / DAYS_PER_MONTH;

  return {
    neededMonthly: fromCents(averageMonthsLeft >= 1 ? remainingCents / averageMonthsLeft : remainingCents),
    daysLeft,
  };
};

/**
 * No tolerance band: early means reaching the target at least a month before the date.
 * Compares whole calendar months, the unit of the displayed ETA, so status and ETA never disagree.
 */
export const scheduleOffset = ({
  etaMonths,
  monthsLeft,
}: {
  etaMonths: number;
  monthsLeft: number;
}): GoalScheduleOffset => {
  const offset = monthsLeft - etaMonths;
  if (offset > 0) return { kind: 'early', months: offset };
  if (offset === 0) return { kind: 'onTime', months: 0 };
  return { kind: 'late', months: -offset };
};

/** 'yyyy-MM-dd' `etaMonths` after `today`; a day past the month's end clamps to its last day. */
export const etaDate = ({ today, etaMonths }: { today: string; etaMonths: number }): string => {
  const [year, month, day] = today.split('-').map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(year, month + etaMonths, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + etaMonths, Math.min(day, lastDay))).toISOString().slice(0, 10);
};

/** Whole months from `today` to `targetDate`, stepped like `etaDate`; negative when the date is past. */
const wholeMonthsUntil = ({ today, targetDate }: { today: string; targetDate: string }): number => {
  const [year, month] = today.split('-').map(Number) as [number, number];
  const [targetYear, targetMonth] = targetDate.split('-').map(Number) as [number, number];
  const months = (targetYear - year) * 12 + targetMonth - month;
  return etaDate({ today, etaMonths: months }) > targetDate ? months - 1 : months;
};

const STATUS_BY_OFFSET: Record<GoalScheduleOffset['kind'], GoalProgressStatus> = {
  early: 'ahead',
  onTime: 'on_track',
  late: 'behind',
};

const progressStatus = ({
  hasAccounts,
  remaining,
  monthsLeft,
  pace,
  eta,
}: {
  hasAccounts: boolean;
  remaining: number;
  monthsLeft: number | null;
  pace: number | null;
  eta: number | null;
}): GoalProgressStatus => {
  if (!hasAccounts) return 'no_accounts';
  if (toCents(remaining) <= 0) return 'reached';
  if (monthsLeft === null) return 'no_date';
  if (monthsLeft < 0) return 'overdue';
  if (pace === null) return 'insufficient_history';
  if (eta === null) return 'behind';
  return STATUS_BY_OFFSET[scheduleOffset({ etaMonths: eta, monthsLeft }).kind];
};

/** Within `reachedHoldDays` of `achievedAt` a goal that dipped below target still reads as reached. */
export const isWithinReachedHold = ({
  achievedAt,
  reachedHoldDays,
  now,
}: {
  achievedAt: string;
  reachedHoldDays: number;
  now: Date;
}): boolean => Date.parse(achievedAt) + reachedHoldDays * MS_PER_DAY > now.getTime();

export const goalDisplayStatus = ({
  status,
  achievedAt,
  reachedHoldDays,
  insights,
  now = new Date(),
}: Pick<GoalModel, 'status' | 'achievedAt' | 'reachedHoldDays'> & {
  insights: Pick<GoalInsights, 'status'> | null;
  now?: Date;
}): GoalDisplayStatus => {
  if (status === 'archived') return 'archived';
  if (achievedAt && isWithinReachedHold({ achievedAt, reachedHoldDays, now })) return 'reached';
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
  const monthsLeft = targetDate ? wholeMonthsUntil({ today, targetDate }) : null;

  return {
    status: progressStatus({
      hasAccounts: accounts.length > 0,
      remaining,
      monthsLeft,
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
    monthsLeft,
  };
};
