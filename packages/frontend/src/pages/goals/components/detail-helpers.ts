import { DAYS_PER_MONTH, accountGoalValue } from '@bt/shared/goals/goal-math';
import type { AccountModel, GoalAccountShare, GoalInsights, RecordId } from '@bt/shared/types';
import { addMonths, parseISO } from 'date-fns';
import { sumBy } from 'lodash-es';

import { toGoalCurrency } from '../helpers';

export const MAX_PROJECTION_MONTHS = 60;

/** Amounts are in the goal currency; null when the goal has no insights or the account no history. */
export interface GoalAccountBreakdown {
  accountId: RecordId;
  sharePercent: number;
  balance: number | null;
  counted: number | null;
  percentOfSaved: number | null;
}

/** `account` is null when the linked account isn't in the accounts store. */
export interface DetailAccountRow extends GoalAccountBreakdown {
  account: AccountModel | null;
}

/**
 * Sorted by counted amount, biggest first. Per-row cent rounding is put on the biggest row
 * so the rows add up to the saved amount shown everywhere else.
 */
export const getAccountBreakdown = ({
  accounts,
  insights,
}: {
  accounts: GoalAccountShare[];
  insights: GoalInsights | null;
}): GoalAccountBreakdown[] => {
  const histories = new Map((insights?.input.accounts ?? []).map((history) => [history.accountId, history]));

  const rows = accounts
    .map(({ accountId, sharePercent }): Omit<GoalAccountBreakdown, 'percentOfSaved'> => {
      const history = histories.get(accountId);
      if (!insights || !history) return { accountId, sharePercent, balance: null, counted: null };
      const counted = accountGoalValue({
        balance: history.currentBalance,
        creditLimit: history.creditLimit,
        sharePercent,
      });
      return {
        accountId,
        sharePercent,
        balance: toGoalCurrency({ amount: history.currentBalance, insights }),
        counted: toGoalCurrency({ amount: counted, insights }),
      };
    })
    .sort((a, b) => (b.counted ?? 0) - (a.counted ?? 0));

  if (!insights) return rows.map((row) => ({ ...row, percentOfSaved: null }));

  const saved = toGoalCurrency({ amount: insights.currentValue, insights });
  const top = rows[0];
  if (top && top.counted !== null) {
    top.counted = Math.round((top.counted + saved - sumBy(rows, (row) => row.counted ?? 0)) * 100) / 100;
  }

  const percentOfSaved = ({ counted }: { counted: number | null }) => {
    if (counted === null) return null;
    return saved > 0 ? (counted / saved) * 100 : 0;
  };
  return rows.map((row) => ({ ...row, percentOfSaved: percentOfSaved(row) }));
};

/** "≈" marks an amount converted from the account's own currency. */
export const formatRowAmount = ({
  row,
  formatted,
  currencyCode,
}: {
  row: Pick<DetailAccountRow, 'account'>;
  formatted: string;
  currencyCode: string;
}) => `${row.account && row.account.currencyCode !== currencyCode ? '≈ ' : ''}${formatted}`;

export type GoalNeed =
  | { kind: 'monthly'; amount: number }
  | { kind: 'dueSoon'; amount: number; days: number }
  | { kind: 'overdue'; amount: number };

/** Goal-currency need. Under a month to the date, or past it, the whole remainder is due, not a monthly amount. */
export const getGoalNeed = ({ insights }: { insights: GoalInsights }): GoalNeed | null => {
  const { neededMonthly, daysLeft } = insights;
  if (neededMonthly === null || daysLeft === null) return null;
  const amount = toGoalCurrency({ amount: neededMonthly, insights });
  if (daysLeft < 0) return { kind: 'overdue', amount };
  if (daysLeft < DAYS_PER_MONTH) return { kind: 'dueSoon', amount, days: daysLeft };
  return { kind: 'monthly', amount };
};

export const getPaceValueClass = ({ pace, need }: { pace: number | null; need: GoalNeed | null }) => {
  if (pace === null) return undefined;
  if (pace < 0) return 'text-destructive-text';
  if (need?.kind === 'monthly' && pace < need.amount) return 'text-warning-text';
  return undefined;
};

/** Goal-currency value at each month end; `change` is the move since the previous point. */
export interface GoalHistoryPoint {
  date: Date;
  value: number;
  change: number | null;
}

export const getGoalHistory = ({ insights }: { insights: GoalInsights }): GoalHistoryPoint[] => {
  const values = insights.input.months.map((_, index) =>
    toGoalCurrency({ amount: insights.monthEndValues[index] ?? 0, insights }),
  );
  return insights.input.months.map((month, index) => ({
    date: parseISO(month),
    value: values[index]!,
    change: index > 0 ? values[index]! - values[index - 1]! : null,
  }));
};

export const getHistorySummary = ({ history }: { history: GoalHistoryPoint[] }) => {
  const first = history[0];
  const last = history.at(-1);
  if (!first || !last || history.length < 2) return null;

  const gain = last.value - first.value;
  const best = history.reduce<GoalHistoryPoint | null>(
    (top, point) => (point.change !== null && point.change > 0 && point.change > (top?.change ?? 0) ? point : top),
    null,
  );

  return {
    gain,
    gainPercent: first.value > 0 ? (gain / first.value) * 100 : null,
    from: first.date,
    to: last.date,
    best,
    bestShareOfGain: best && gain > 0 ? (best.change! / gain) * 100 : null,
  };
};

/** Straight line from today at the current pace up to the ETA, capped at `MAX_PROJECTION_MONTHS`. */
export const getProjection = ({ insights }: { insights: GoalInsights }): { date: Date; value: number }[] => {
  if (insights.status === 'reached' || insights.pace === null || insights.pace <= 0) return [];

  const today = parseISO(insights.input.today);
  const saved = toGoalCurrency({ amount: insights.currentValue, insights });
  const pace = toGoalCurrency({ amount: insights.pace, insights });
  const months = Math.min(insights.etaMonths ?? MAX_PROJECTION_MONTHS, MAX_PROJECTION_MONTHS);

  return Array.from({ length: months + 1 }, (_, month) => ({
    date: addMonths(today, month),
    value: saved + pace * month,
  }));
};
