import type { EmbeddedCategoryModel } from './categories';
import type { EntityLogoFields } from './entity-logo';
import type { RecordId } from './record-id';
import type { ResourceShareInfo } from './sharing';
import type { TagModel } from './tags';
import type { TransactionModel } from './transactions';

// Everything in this file belongs to the user-facing "Trackers" (`Trackers` table).
// The user-facing "Budget" is typed in budget-plans.ts.
export enum TRACKER_STATUSES {
  active = 'active',
  closed = 'closed',
  archived = 'archived',
}

/** Per-category limit inside a tracker (`TrackerLines` table). */
export interface TrackerLineModel {
  id: RecordId;
  trackerId: RecordId;
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

export interface TrackerModel extends EntityLogoFields {
  id: RecordId;
  userId: number;
  status: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
  /** Decimal; null = no overall limit. */
  limitAmount: number | null;
  /** Owner's transactions in the date range matching any of `categories` or `tags` get linked automatically. */
  rulesEnabled: boolean;
  /** Rule-added links whose transaction stopped matching are removed on the next sync. */
  rulesCleanup: boolean;
  rulesSyncedAt: Date | null;
  /** The "Archive?" suggestion chip stays hidden once the user opts out for this tracker. */
  archivePromptDismissed: boolean;
  /** Smart tracking: AI links matching transactions to this tracker. Owner-only. */
  aiEnabled: boolean;
  aiDescription: string | null;
  /** How many days before `startDate` the AI also looks at. One of `TRACKER_AI_PRE_WINDOW_DAYS`. */
  aiPreWindowDays: TrackerAiPreWindowDays;
  aiLastScannedAt: Date | null;
  /** Rule categories. Write-only; parent ids are expanded to children server-side. */
  categoryIds?: string[];
  /** Rule categories, read-only. */
  categories?: EmbeddedCategoryModel[];
  /** Rule tags, read-only. */
  tags?: Pick<TagModel, 'id' | 'name' | 'color' | 'icon'>[];
  /** Ordered by `position`. Present on GET list/detail responses. */
  lines: TrackerLineModel[];
  /** Present on user-facing list/detail responses; absent on internal serializations. */
  share?: ResourceShareInfo;
}

export interface TrackerStatsLine {
  lineId: RecordId;
  /** Decimal, positive. Gross expenses matched to this line, refunds not netted. */
  spent: number;
}

export interface TrackerStatsResponse {
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
  lines: TrackerStatsLine[];
  /** Decimal, positive. Expenses not matched by any line. */
  otherSpent: number;
}

// Tracker Spending Stats
export interface TrackerSpendingByCategoryItem {
  categoryId: RecordId;
  name: string;
  color: string;
  amount: number; // decimal, positive (expenses only)
  children?: TrackerSpendingByCategoryItem[];
}

export type TrackerSpendingGranularity = 'monthly' | 'weekly' | 'daily';

export interface TrackerSpendingPeriod {
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;
  expense: number; // decimal, positive
  income: number; // decimal, positive
}

export interface TrackerSpendingByCurrencyItem {
  currencyCode: string;
  /** Decimal, positive, in `currencyCode`. */
  amount: number;
  /** Decimal, positive, in the base currency. */
  refAmount: number;
}

export interface TrackerSpendingPayeeItem extends EntityLogoFields {
  payeeId: RecordId | null;
  name: string | null;
  /** Decimal, positive, base currency. */
  amount: number;
  transactionsCount: number;
}

export interface TrackerSpendingStatsResponse {
  spendingsByCategory: TrackerSpendingByCategoryItem[];
  spendingOverTime: {
    granularity: TrackerSpendingGranularity;
    periods: TrackerSpendingPeriod[];
  };
  /** Expenses grouped by original transaction currency, largest `refAmount` first. */
  spendingsByCurrency: TrackerSpendingByCurrencyItem[];
  /** Top 5 payees by expense, base currency. */
  topPayees: TrackerSpendingPayeeItem[];
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

/** POST /trackers/:id/sync */
export interface TrackerSyncResponse {
  added: number;
  removed: number;
}

/** GET /trackers/:id/suggestions */
export interface TrackerSuggestionsResponse<TTransaction = TransactionModel> {
  /** Highest score first. */
  pending: TrackerPendingSuggestion<TTransaction>[];
  /** Linked transactions the AI matched, for an "AI" badge on the tracker's rows. `id` is the suggestion's, for reject. */
  aiMatched: { id: RecordId; transactionId: RecordId; reason: string }[];
  /** Removed or rejected transactions that rules and AI skip. Score 0 = removed by hand. Restore to allow again. */
  rejected: TrackerPendingSuggestion<TTransaction>[];
  scan: {
    status: TrackerScanStatus;
    startedAt: Date | null;
    lastScannedAt: Date | null;
    /** Null while smart tracking is off or can run. */
    pausedReason: TrackerScanPausedReason | null;
  };
}

/** POST /trackers/:id/suggestions/{accept,reject,restore} */
export interface ResolveTrackerSuggestionsBody {
  suggestionIds: RecordId[];
}

export interface ResolveTrackerSuggestionsResponse {
  resolvedCount: number;
}

/** SSE `tracker_scan_status`, sent to the tracker owner. Counts are set on `done`. */
export interface TrackerScanStatusPayload {
  trackerId: RecordId;
  status: 'queued' | 'running' | 'done' | 'failed';
  linkedCount?: number;
  suggestedCount?: number;
}
