import { toLocalCurrencyNumber } from '@/js/helpers';
import {
  FULL_SHARE,
  accountGoalValue,
  etaDate,
  goalDisplayStatus,
  roundShare,
  scheduleOffset,
  toGoalCurrency as toGoalCurrencyFromBase,
} from '@bt/shared/goals/goal-math';
import {
  ACCOUNT_CATEGORIES,
  type AccountModel,
  GOAL_STATUSES_HOLDING_SHARES,
  type GoalAccountShare,
  type GoalDisplayStatus,
  type GoalInsights,
  type GoalModel,
  type GoalProgress,
  type GoalScheduleOffset,
  type RecordId,
} from '@bt/shared/types';
import { sumBy } from 'lodash-es';

export const MARKET_CATEGORIES: readonly ACCOUNT_CATEGORIES[] = [
  ACCOUNT_CATEGORIES.investment,
  ACCOUNT_CATEGORIES.crypto,
];

export type GoalSection = 'active' | 'ended' | 'archived';

export const GOAL_SECTION_ORDER: readonly GoalSection[] = ['active', 'ended', 'archived'];

type SectionFields = Pick<GoalModel, 'status' | 'achievedAt' | 'reachedHoldDays' | 'insights'>;

export const getGoalSection = ({ goal }: { goal: SectionFields }): GoalSection => {
  if (!GOAL_STATUSES_HOLDING_SHARES.includes(goal.status)) return 'archived';
  if (goalDisplayStatus(goal) === 'reached') return 'ended';
  return 'active';
};

export const splitGoalSections = <T extends SectionFields>({ goals }: { goals: T[] }): Record<GoalSection, T[]> => {
  const sections: Record<GoalSection, T[]> = { active: [], ended: [], archived: [] };
  for (const goal of goals) sections[getGoalSection({ goal })].push(goal);
  return sections;
};

type RateSource = Pick<GoalInsights, 'rateToBase'>;

/** Insights amounts are base-currency decimals; this turns one into the goal currency. Null in, null out. */
export function toGoalCurrency(params: { amount: number; insights: RateSource }): number;
export function toGoalCurrency(params: { amount: number | null; insights: RateSource | null }): number | null;
export function toGoalCurrency({ amount, insights }: { amount: number | null; insights: RateSource | null }) {
  return insights ? toGoalCurrencyFromBase({ amount, rateToBase: insights.rateToBase }) : null;
}

export const getGoalProgress = ({
  goal,
}: {
  goal: Pick<GoalModel, 'targetAmount' | 'insights'>;
}): { saved: number; percent: number } | null => {
  const { insights } = goal;
  if (!insights) return null;

  const saved = toGoalCurrency({ amount: insights.currentValue, insights });
  const percent = goal.targetAmount > 0 ? Math.floor((saved / goal.targetAmount) * 100) : 0;
  // Keeps the bar off 100% until the server calls it reached, and on it once it has.
  return { saved, percent: insights.status === 'reached' ? Math.max(100, percent) : Math.min(99, percent) };
};

export const getGoalDisplayKind = ({ goal }: { goal: SectionFields }): GoalDisplayStatus => goalDisplayStatus(goal);

type GoalTone = { textClass: string; barClass: string; pillClass: string };

const TONES = {
  success: {
    textClass: 'text-success-text',
    barClass: 'bg-success-text',
    pillClass: 'bg-success-text/15 text-success-text',
  },
  warning: {
    textClass: 'text-warning-text',
    barClass: 'bg-warning',
    pillClass: 'bg-warning-text/15 text-warning-text',
  },
  destructive: {
    textClass: 'text-destructive-text',
    barClass: 'bg-destructive',
    pillClass: 'bg-destructive-text/15 text-destructive-text',
  },
  primary: { textClass: 'text-primary-text', barClass: 'bg-primary', pillClass: 'bg-primary/15 text-primary-text' },
  muted: {
    textClass: 'text-muted-foreground',
    barClass: 'bg-muted-foreground/40',
    pillClass: 'bg-muted text-muted-foreground',
  },
} satisfies Record<string, GoalTone>;

export const GOAL_DISPLAY_TONES: Record<GoalDisplayStatus, GoalTone> = {
  reached: TONES.success,
  ahead: TONES.success,
  on_track: TONES.success,
  behind: TONES.warning,
  overdue: TONES.destructive,
  no_date: TONES.primary,
  insufficient_history: TONES.muted,
  no_accounts: TONES.muted,
  paused: TONES.muted,
  archived: TONES.muted,
  no_rate: TONES.muted,
};

/** An i18n key; `count` doubles as the plural choice, `date` ('yyyy-MM-dd') is formatted by the caller. */
interface GoalStatusLabel {
  key: string;
  count?: number;
  date?: string;
}

const STATUS_LABEL_KEYS: Record<GoalDisplayStatus, string> = {
  reached: 'goals.status.reached',
  ahead: 'goals.status.ahead',
  on_track: 'goals.status.onTrack',
  behind: 'goals.status.behind',
  overdue: 'goals.status.overdue',
  no_date: 'goals.status.noDate',
  insufficient_history: 'goals.status.insufficientHistory',
  no_accounts: 'goals.status.noAccounts',
  paused: 'goals.status.paused',
  archived: 'goals.status.archived',
  no_rate: 'goals.status.noRate',
};

export const getGoalStatusLabel = ({
  status,
  progress,
  today,
}: {
  status: GoalDisplayStatus;
  progress: Pick<GoalProgress, 'etaMonths' | 'daysLeft'> | null;
  today?: string;
}): GoalStatusLabel => {
  const etaMonths = progress?.etaMonths ?? null;
  const daysLeft = progress?.daysLeft ?? null;

  if (status === 'behind' && etaMonths !== null && daysLeft !== null) {
    return { key: 'goals.status.behindBy', count: scheduleOffset({ etaMonths, daysLeft }).months };
  }
  if (status === 'no_date' && etaMonths !== null && today) {
    return { key: 'goals.status.around', date: etaDate({ today, etaMonths }) };
  }
  return { key: STATUS_LABEL_KEYS[status] };
};

/** Null unless the status is one of the dated pace statuses, so "early" only shows for ahead and "late" for behind. */
export const getScheduleOffset = ({
  progress,
}: {
  progress: Pick<GoalProgress, 'status' | 'etaMonths' | 'daysLeft'>;
}): GoalScheduleOffset | null => {
  const { status, etaMonths, daysLeft } = progress;
  if (etaMonths === null || daysLeft === null || !['ahead', 'on_track', 'behind'].includes(status)) return null;
  return scheduleOffset({ etaMonths, daysLeft });
};

export const isGoalBehind = ({ goal }: { goal: SectionFields }) => {
  const kind = getGoalDisplayKind({ goal });
  return kind === 'behind' || kind === 'overdue';
};

/**
 * `free` is the account's share unclaimed by goals that hold shares, leaving out the goal being edited.
 * `max` is what that goal may take: an archived goal holds no capacity, so the server skips the limit for it.
 */
export const getAccountShareCapacity = ({
  goals,
  accountId,
  editingGoal,
}: {
  goals: Pick<GoalModel, 'id' | 'name' | 'status' | 'accounts'>[];
  accountId: RecordId;
  editingGoal?: Pick<GoalModel, 'id' | 'status'>;
}): { free: number; max: number; holders: { name: string; sharePercent: number }[] } => {
  const holders = goals
    .filter((goal) => goal.id !== editingGoal?.id && GOAL_STATUSES_HOLDING_SHARES.includes(goal.status))
    .flatMap((goal) =>
      goal.accounts.flatMap(({ accountId: linkedId, sharePercent }) =>
        linkedId === accountId && sharePercent !== null ? [{ name: goal.name, sharePercent }] : [],
      ),
    );
  const free = Math.max(0, roundShare(FULL_SHARE - sumBy(holders, 'sharePercent')));
  const skipsCapacity = !!editingGoal && !GOAL_STATUSES_HOLDING_SHARES.includes(editingGoal.status);

  return { free, max: skipsCapacity ? FULL_SHARE : free, holders };
};

export interface FixedAmountHolder {
  goalId: RecordId;
  name: string;
  /** In the account's currency. */
  fixedAmount: number;
}

/** The other share-holding goals' fixed amounts on the account, in the order they are filled. */
export const getAccountFixedHolders = ({
  goals,
  accountId,
  editingGoalId,
}: {
  goals: Pick<GoalModel, 'id' | 'name' | 'status' | 'accounts'>[];
  accountId: RecordId;
  editingGoalId?: RecordId;
}): FixedAmountHolder[] =>
  goals
    .filter((goal) => goal.id !== editingGoalId && GOAL_STATUSES_HOLDING_SHARES.includes(goal.status))
    .flatMap((goal) =>
      goal.accounts.flatMap((share) =>
        share.accountId === accountId && share.fixedAmount !== null
          ? [{ goalId: goal.id, name: goal.name, fixedAmount: share.fixedAmount, position: share.fixedPosition ?? 0 }]
          : [],
      ),
    )
    .sort((a, b) => a.position - b.position || a.goalId.localeCompare(b.goalId))
    .map(({ position: _position, ...holder }) => holder);

/**
 * What a share counts from the account now, as a base-currency decimal; null when the account's
 * rate is unknown. A fixed share sits at its `fixedPosition` among `holders`, or after them.
 */
export const countedFromAccount = ({
  account,
  share,
  holders,
}: {
  account: Pick<AccountModel, 'currentBalance' | 'creditLimit' | 'refCurrentBalance'>;
  share: Pick<GoalAccountShare, 'sharePercent' | 'fixedAmount' | 'fixedPosition'>;
  holders: Pick<FixedAmountHolder, 'fixedAmount'>[];
}): number | null => {
  const position = Math.min(share.fixedPosition ?? holders.length, holders.length);
  const counted = accountGoalValue({
    balance: account.currentBalance,
    creditLimit: account.creditLimit,
    sharePercent: share.sharePercent,
    fixedAmount: share.fixedAmount,
    fixedAhead: sumBy(holders.slice(0, position), 'fixedAmount'),
    fixedOthers: sumBy(holders, 'fixedAmount'),
  });
  if (!counted) return 0;
  // A zero base balance against a non-zero own one means the rate is unknown, not zero.
  if (!account.refCurrentBalance) return null;
  // ponytail: the account's base-to-own balance ratio stands in for today's rate
  return Math.round(((counted * account.refCurrentBalance) / account.currentBalance) * 100) / 100;
};

/** "40%", or the fixed amount in the account's currency; a bare number while that currency is unknown. */
export const formatGoalLinkLabel = ({
  share,
  currencyCode,
  formatAmount,
}: {
  share: Pick<GoalAccountShare, 'sharePercent' | 'fixedAmount'>;
  currencyCode: string | undefined;
  formatAmount: (params: { amount: number; currencyCode: string }) => string;
}) => {
  if (share.fixedAmount === null) return `${share.sharePercent}%`;
  return currencyCode
    ? formatAmount({ amount: share.fixedAmount, currencyCode })
    : toLocalCurrencyNumber(share.fixedAmount);
};
