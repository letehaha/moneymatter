import type { EmbeddedCategoryModel } from './categories';
import type { EntityLogoFields } from './entity-logo';
import type { RecordId } from './record-id';
import type { ResourceShareInfo } from './sharing';
import type { TransactionModel } from './transactions';

// Everything in this file belongs to the user-facing "Trackers" (`Budgets` table).
// The user-facing "Budget" is typed in budget-plans.ts.
export enum BUDGET_STATUSES {
  active = 'active',
  closed = 'closed',
  archived = 'archived',
}

export enum BUDGET_TYPES {
  manual = 'manual',
  category = 'category',
}

/** Per-category limit inside a tracker (`TrackerLines` table). */
export interface TrackerLineModel {
  id: RecordId;
  budgetId: RecordId;
  name: string;
  /** Decimal; null = no limit on this line. */
  limitAmount: number | null;
  position: number;
  categories: EmbeddedCategoryModel[];
}

export interface TrackerLinePayload {
  name: string;
  limitAmount?: number | null;
  /** Parent ids are expanded to children server-side. */
  categoryIds: string[];
  position?: number;
}

export interface BudgetModel extends EntityLogoFields {
  id: RecordId;
  userId: number;
  status: string;
  name: string;
  type: BUDGET_TYPES;
  startDate: Date | null;
  endDate: Date | null;
  /** Decimal; null = no overall limit. */
  limitAmount: number | null;
  autoInclude: boolean;
  /** The "Archive?" suggestion chip stays hidden once the user opts out for this tracker. */
  archivePromptDismissed: boolean;
  /** Smart tracking: AI links matching transactions to this manual tracker. Owner-only. */
  aiEnabled: boolean;
  aiDescription: string | null;
  /** How many days before `startDate` the AI also looks at. One of `TRACKER_AI_PRE_WINDOW_DAYS`. */
  aiPreWindowDays: TrackerAiPreWindowDays;
  aiLastScannedAt: Date | null;
  /**
   * Category IDs for category-based budgets.
   * Use for CREATE/UPDATE requests - the backend will expand parent IDs to include children.
   * Not populated in GET responses (use `categories` array instead).
   */
  categoryIds?: string[];
  /**
   * Full category objects for category-based budgets.
   * Populated in GET responses when budget has associated categories.
   * Read-only - for mutations, use `categoryIds`.
   */
  categories?: EmbeddedCategoryModel[];
  /** Ordered by `position`. Present on GET list/detail responses. */
  lines: TrackerLineModel[];
  /** Present on user-facing list/detail responses; absent on internal serializations. */
  share?: ResourceShareInfo;
}

export interface BudgetStatsLine {
  lineId: RecordId;
  /** Decimal, positive. Gross expenses matched to this line, refunds not netted. */
  spent: number;
}

export interface BudgetStatsResponse {
  summary: {
    actualIncome: number;
    actualExpense: number;
    /** Net difference, income minus expenses. */
    balance: number;
    /** Percentage used (0-100+), null without an overall limit. */
    utilizationRate: null | number;
    transactionsCount: number;
    firstTransactionDate: string | null;
    lastTransactionDate: string | null;
  };
  /** One entry per tracker line, in line order. */
  lines: BudgetStatsLine[];
  /** Decimal, positive. Expenses not matched by any line. */
  otherSpent: number;
}

// Budget Spending Stats
export interface BudgetSpendingByCategoryItem {
  categoryId: RecordId;
  name: string;
  color: string;
  amount: number; // decimal, positive (expenses only)
  children?: BudgetSpendingByCategoryItem[];
}

export type BudgetSpendingGranularity = 'monthly' | 'weekly' | 'daily';

export interface BudgetSpendingPeriod {
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;
  expense: number; // decimal, positive
  income: number; // decimal, positive
}

export interface BudgetSpendingByCurrencyItem {
  currencyCode: string;
  /** Decimal, positive, in `currencyCode`. */
  amount: number;
  /** Decimal, positive, in the base currency. */
  refAmount: number;
}

export interface BudgetSpendingPayeeItem extends EntityLogoFields {
  payeeId: RecordId | null;
  name: string | null;
  /** Decimal, positive, base currency. */
  amount: number;
  transactionsCount: number;
}

export interface BudgetSpendingStatsResponse {
  spendingsByCategory: BudgetSpendingByCategoryItem[];
  spendingOverTime: {
    granularity: BudgetSpendingGranularity;
    periods: BudgetSpendingPeriod[];
  };
  /** Expenses grouped by original transaction currency, largest `refAmount` first. */
  spendingsByCurrency: BudgetSpendingByCurrencyItem[];
  /** Top 5 payees by expense, base currency. */
  topPayees: BudgetSpendingPayeeItem[];
  /** The single calendar day with the highest expense, null without expenses. */
  biggestDay: { date: string; expense: number } | null;
}

export const TRACKER_AI_PRE_WINDOW_DAYS = [0, 14, 30, 60, 90, 180] as const;
export type TrackerAiPreWindowDays = (typeof TRACKER_AI_PRE_WINDOW_DAYS)[number];
export const TRACKER_AI_DEFAULT_PRE_WINDOW_DAYS: TrackerAiPreWindowDays = 60;
export const TRACKER_AI_DESCRIPTION_MAX_LENGTH = 500;

/** At or above: linked straight away. */
export const TRACKER_AI_AUTO_LINK_SCORE = 0.85;
/** At or above: kept as a pending suggestion. Below: dropped. */
export const TRACKER_AI_SUGGEST_SCORE = 0.5;
/** At or above: a pending suggestion reads as "likely". */
export const TRACKER_AI_LIKELY_SCORE = 0.7;

export enum TRACKER_SUGGESTION_STATUS {
  pending = 'pending',
  accepted = 'accepted',
  rejected = 'rejected',
  autoLinked = 'auto_linked',
}

export type TrackerScanStatus = 'idle' | 'queued' | 'running';

export type TrackerScanPausedReason = 'archived' | 'no_start_date' | 'ended' | 'plan' | 'allowance' | 'unavailable';

export interface TrackerPendingSuggestion<TTransaction = TransactionModel> {
  id: RecordId;
  score: number;
  reason: string;
  transaction: TTransaction;
}

/** GET /budgets/:id/suggestions */
export interface TrackerSuggestionsResponse<TTransaction = TransactionModel> {
  /** Highest score first. */
  pending: TrackerPendingSuggestion<TTransaction>[];
  /** Linked transactions the AI matched, for an "AI" badge on the tracker's rows. `id` is the suggestion's, for reject. */
  aiMatched: { id: RecordId; transactionId: RecordId; reason: string }[];
  scan: {
    status: TrackerScanStatus;
    startedAt: Date | null;
    lastScannedAt: Date | null;
    /** Null while smart tracking is off or can run. */
    pausedReason: TrackerScanPausedReason | null;
  };
}

/** POST /budgets/:id/suggestions/{accept,reject,restore} */
export interface ResolveTrackerSuggestionsBody {
  suggestionIds: RecordId[];
}

export interface ResolveTrackerSuggestionsResponse {
  resolvedCount: number;
}

/** SSE `tracker_scan_status`, sent to the tracker owner. Counts are set on `done`. */
export interface TrackerScanStatusPayload {
  budgetId: RecordId;
  status: 'queued' | 'running' | 'done' | 'failed';
  linkedCount?: number;
  suggestedCount?: number;
}
