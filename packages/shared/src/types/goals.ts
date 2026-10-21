import { ACCOUNT_CATEGORIES } from './accounts';
import type { EntityLogoFields, EntityLogoWritePayload } from './entity-logo';
import type { RecordId } from './record-id';

// Savings goals (`Goals` table). Envelope line goals of the budget live in budget-plans.ts.
export const GOAL_STATUSES = ['active', 'paused', 'archived'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Goals in these statuses count toward each linked account's 100% share capacity. */
export const GOAL_STATUSES_HOLDING_SHARES: readonly GoalStatus[] = ['active', 'paused'];

export const GOAL_NAME_MAX_LENGTH = 100;

/** Owned accounts of these categories may back a goal; debt and non-cash categories never do. */
export const GOAL_ELIGIBLE_ACCOUNT_CATEGORIES: readonly ACCOUNT_CATEGORIES[] = [
  ACCOUNT_CATEGORIES.general,
  ACCOUNT_CATEGORIES.cash,
  ACCOUNT_CATEGORIES.currentAccount,
  ACCOUNT_CATEGORIES.saving,
  ACCOUNT_CATEGORIES.investment,
  ACCOUNT_CATEGORIES.crypto,
];

export interface GoalAccountShare {
  accountId: RecordId;
  /** Share of the account's balance that counts toward the goal, 0 < x ≤ 100, two decimals. */
  sharePercent: number;
}

export interface GoalModel extends EntityLogoFields {
  id: RecordId;
  name: string;
  /** Target currency; `targetAmount`, `plannedMonthly` and `achievedAmount` are in it. */
  currencyCode: string;
  /** Decimal. */
  targetAmount: number;
  /** 'yyyy-MM-dd'. */
  targetDate: string | null;
  /** Decimal per month. */
  plannedMonthly: number | null;
  status: GoalStatus;
  achievedAt: string | null;
  /** Decimal. */
  achievedAmount: number | null;
  sortOrder: number;
  accounts: GoalAccountShare[];
  /** Null when today's rate from the goal currency to the base currency is unavailable. */
  insights: GoalInsights | null;
  createdAt: string;
  updatedAt: string;
}

export const GOAL_PROGRESS_STATUSES = [
  'no_accounts',
  'reached',
  'overdue',
  'no_date',
  'insufficient_history',
  'ahead',
  'on_track',
  'behind',
] as const;
export type GoalProgressStatus = (typeof GOAL_PROGRESS_STATUSES)[number];

export type GoalDisplayStatus = GoalProgressStatus | 'paused' | 'archived' | 'no_rate';

export type GoalScheduleOffset = { kind: 'early' | 'onTime' | 'late'; months: number };

/** One linked account as the goal math sees it. Amounts are base-currency decimals. */
export interface GoalAccountHistory extends GoalAccountShare {
  currentBalance: number;
  /** Subtracted from every balance, past points included, before the share applies. */
  creditLimit: number;
  /** 'yyyy-MM-dd' of the account's earliest balance row; null when it has none. */
  firstDataDate: string | null;
  /** Raw balance at each `GoalMathInput.months` date. */
  monthEndBalances: number[];
}

/** Amounts are base-currency decimals (the target and monthly plan converted at today's rate). */
export interface GoalMathInput {
  /** 'yyyy-MM-dd'. Month ends before it are full months. */
  today: string;
  /** Month-end dates 'yyyy-MM-dd', oldest first; the last one is `today`. */
  months: string[];
  accounts: GoalAccountHistory[];
  targetAmount: number;
  targetDate: string | null;
  plannedMonthly: number | null;
}

/** Amounts are base-currency decimals. */
export interface GoalProgress {
  status: GoalProgressStatus;
  currentValue: number;
  remaining: number;
  /** Goal value at each `GoalMathInput.months` date. */
  monthEndValues: number[];
  /** Median monthly change over the last full months; null below the minimum history. */
  historicalPace: number | null;
  /** Monthly changes behind `historicalPace`. */
  historyMonths: number;
  /** `plannedMonthly` when set, else `historicalPace`. */
  pace: number | null;
  etaMonths: number | null;
  /** Under one month left (or overdue) it is the whole `remaining`. */
  neededMonthly: number | null;
  daysLeft: number | null;
}

/**
 * All amounts are in the user's base currency, decimals. Divide one by `rateToBase` to show it
 * in the goal currency.
 */
export interface GoalInsights extends GoalProgress {
  /** Exactly what produced these numbers; the What-if re-runs `computeGoalProgress` on an edited copy. */
  input: GoalMathInput;
  /** Base-currency units per one unit of the goal currency, today. */
  rateToBase: number;
  baseCurrencyCode: string;
}

export interface CreateGoalPayload extends EntityLogoWritePayload {
  name: string;
  currencyCode: string;
  /** Decimal. */
  targetAmount: number;
  targetDate?: string | null;
  /** Decimal per month. */
  plannedMonthly?: number | null;
  sortOrder?: number;
  accounts: GoalAccountShare[];
}

/** `accounts`, when sent, replaces the whole set. */
export type UpdateGoalPayload = Partial<CreateGoalPayload> & { status?: GoalStatus };

/** `details` of the 409 a write gets when an account's shares across non-archived goals would pass 100%. */
export type GoalShareCapacityExceededDetails = {
  accountId: RecordId;
  accountName: string;
  requested: number;
  usedByOtherGoals: number;
  free: number;
};
