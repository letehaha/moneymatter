import { DAYS_PER_MONTH, FULL_SHARE, accountGoalValue } from '@bt/shared/goals/goal-math';
import type { AccountModel, GoalAccountShare, GoalInsights, RecordId } from '@bt/shared/types';
import { addMonths, parseISO } from 'date-fns';
import { sumBy } from 'lodash-es';
import type { ComposerTranslation } from 'vue-i18n';

import { toGoalCurrency } from '../helpers';

export const MAX_PROJECTION_MONTHS = 60;

/** Amounts are in the goal currency; null when the goal has no insights or the account no history. */
interface GoalAccountBreakdown {
  accountId: RecordId;
  sharePercent: number | null;
  /** In the account's currency, as linked. */
  fixedAmount: number | null;
  balance: number | null;
  /** The fixed amount, or the balance the share applies to once other goals' fixed amounts are out. */
  base: number | null;
  /** Other goals' fixed amounts come out of this account before the share. */
  afterFixed: boolean;
  counted: number | null;
  /** A fixed amount the account can't fully cover. */
  isShort: boolean;
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
    .map(({ accountId, sharePercent, fixedAmount }): Omit<GoalAccountBreakdown, 'percentOfSaved'> => {
      const history = histories.get(accountId);
      const link = { accountId, sharePercent, fixedAmount };
      if (!insights || !history) {
        return { ...link, balance: null, base: null, afterFixed: false, counted: null, isShort: false };
      }
      const counted = accountGoalValue({ ...history, balance: history.currentBalance });
      const available = Math.max(0, history.currentBalance - history.creditLimit);
      const base = history.fixedAmount ?? Math.max(0, available - history.fixedOthers);
      return {
        ...link,
        balance: toGoalCurrency({ amount: history.currentBalance, insights }),
        base: toGoalCurrency({ amount: base, insights }),
        afterFixed: history.fixedOthers > 0,
        counted: toGoalCurrency({ amount: counted, insights }),
        isShort: history.fixedAmount !== null && counted < history.fixedAmount,
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

type AccountRowCaption = { key: string; isShort: boolean; share?: number; amount?: number; counted?: number };

/** An i18n key with its params; amounts come back unformatted. */
export const getAccountRowCaption = ({
  row,
}: {
  row: Pick<
    GoalAccountBreakdown,
    'sharePercent' | 'fixedAmount' | 'balance' | 'base' | 'afterFixed' | 'counted' | 'isShort'
  >;
}): AccountRowCaption | null => {
  if (row.fixedAmount !== null) {
    if (row.base === null || row.counted === null) return null;
    return row.isShort
      ? { key: 'goals.details.accounts.fixedShort', isShort: true, counted: row.counted, amount: row.base }
      : { key: 'goals.details.accounts.fixed', isShort: false, amount: row.base };
  }
  const share = row.sharePercent!;
  const plain = { key: 'goals.details.accounts.sharePlain', isShort: false, share };
  if (row.base === null || row.balance === null) return plain;
  if (row.afterFixed) return { key: 'goals.details.accounts.shareOfLeft', isShort: false, share, amount: row.base };
  if (share === FULL_SHARE) return plain;
  return { key: 'goals.details.accounts.shareOf', isShort: false, share, amount: row.balance };
};

export const formatAccountRowCaption = ({
  row,
  t,
  formatAmount,
}: {
  row: Parameters<typeof getAccountRowCaption>[0]['row'];
  t: ComposerTranslation;
  formatAmount: (params: { amount: number }) => string;
}): { text: string; isShort: boolean } | null => {
  const caption = getAccountRowCaption({ row });
  if (!caption) return null;
  const { key, isShort, share, amount, counted } = caption;
  return {
    text: t(key, {
      share,
      amount: amount === undefined ? undefined : formatAmount({ amount }),
      counted: counted === undefined ? undefined : formatAmount({ amount: counted }),
    }),
    isShort,
  };
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
