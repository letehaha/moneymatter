/**
 * Shared contracts for the YNAB CSV import pipeline. Lives in the shared
 * package so backend (parser, queue, controllers) and frontend (wizard UI,
 * Pinia store, API client) stay in sync.
 *
 * Monetary values cross the wire as decimals (e.g. 12.34) — the convention
 * for HTTP boundaries in this codebase. Internal Money arithmetic happens
 * on each side independently.
 */

import { IMPORT_JOB_STATUSES } from './core';
import type { ImportJobStatus } from './core';

/** YNAB Register.csv flag colors. Empty/unflagged rows are omitted. */
export const YNAB_FLAG_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type YnabFlagColor = (typeof YNAB_FLAG_COLORS)[number];

/** Hex used both for the auto-created tag color and the UI swatch in preview.
 *  Single source so backend (createTag) and frontend (swatch) cannot drift. */
export const YNAB_FLAG_HEX: Record<YnabFlagColor, string> = {
  red: '#EF4444',
  orange: '#F97316',
  yellow: '#EAB308',
  green: '#22C55E',
  blue: '#3B82F6',
  purple: '#A855F7',
};

/** Hard cap on Register.csv rows the parser will accept. Mirrors the generic
 *  CSV import limit so a single rogue upload can't OOM the parse step. */
export const YNAB_MAX_REGISTER_ROWS = 100_000;

/** Magic payee YNAB injects per account for its synthetic opening row. */
export const YNAB_STARTING_BALANCE_PAYEE = 'Starting Balance';

/** Magic category YNAB uses for income / unassigned cash. */
export const YNAB_READY_TO_ASSIGN_CATEGORY = 'Inflow: Ready to Assign';

/** YNAB encodes transfers via this payee prefix; the suffix is the other
 *  account's display name. */
export const YNAB_TRANSFER_PAYEE_PREFIX = 'Transfer : ';

/** Distinct account discovered in Register.csv, ready for the preview step. */
export interface YnabParseAccount {
  /** Verbatim Account column value, used as the join key in the mapping payload. */
  originalName: string;
  /** Three-letter ISO code parsed from the `(CCY)` token in the account name,
   *  or null if the pattern didn't match — user picks in preview. */
  detectedCurrency: string | null;
  /** Initial balance derived from YNAB's synthetic Starting Balance row.
   *  Positive (Inflow), negative (Outflow), or 0 if no opening row exists. */
  startingBalance: number;
  /** Transactions belonging to this account (excludes the Starting Balance row). */
  transactionCount: number;
}

/** Distinct Category Group → Category pair. */
export interface YnabParseCategory {
  groupName: string;
  categoryName: string;
  /** "<Group>: <Category>" as it appears in the CSV's combined column. */
  fullName: string;
  transactionCount: number;
}

/** Distinct payee (excluding `Starting Balance` and `Transfer : *`). */
export interface YnabParsePayee {
  name: string;
  transactionCount: number;
}

/** Flag color usage summary. Drives "what tags will be created?" UI hint. */
export interface YnabParseTagUsage {
  color: YnabFlagColor;
  transactionCount: number;
}

/** Single non-transfer, non-split, non-starting-balance transaction row. */
export interface YnabParseTransaction {
  rowIndex: number;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  accountName: string;
  payeeName: string;
  categoryGroup: string | null;
  categoryName: string | null;
  memo: string;
  /** Signed decimal in the account's currency. Negative = outflow (expense),
   *  positive = inflow (income). */
  amount: number;
  flag: YnabFlagColor | null;
}

/** A pair of Register.csv rows we matched as a self-transfer between two
 *  user accounts. Only one row's `amount` is stored — the opposite leg is
 *  implied. */
export interface YnabParseTransfer {
  /** Source account = where money LEAVES (outflow row). */
  sourceAccountName: string;
  /** Destination account = where money ARRIVES (inflow row). */
  destinationAccountName: string;
  date: string;
  /** Always positive decimal in source-account currency. */
  amount: number;
  memo: string;
  flag: YnabFlagColor | null;
  /** Original CSV row indices, in order [outflowRow, inflowRow]. */
  rowIndices: [number, number];
}

/** Non-fatal parser observation surfaced to the user in the preview step. */
export interface YnabParseWarning {
  rowIndex?: number;
  code:
    | 'currency-undetected'
    | 'transfer-counterpart-missing'
    | 'unparseable-amount'
    | 'unparseable-date'
    | 'ambiguous-date-order'
    | 'unknown-flag'
    | 'row-skipped';
  message: string;
}

/** Snapshot of what the parser found, shown verbatim in the preview step
 *  and re-posted on execute so the worker doesn't have to re-parse. */
export interface YnabParseResult {
  accounts: YnabParseAccount[];
  categories: YnabParseCategory[];
  payees: YnabParsePayee[];
  tagsUsed: YnabParseTagUsage[];
  transactions: YnabParseTransaction[];
  transfers: YnabParseTransfer[];
  /** Number of detected split groups (consecutive `Split (…)` memo rows).
   *  Informational only — each child row is imported as a standalone
   *  transaction; consolidating them into real split transactions is a
   *  follow-up. */
  detectedSplitCount: number;
  warnings: YnabParseWarning[];
  /** Date range (ISO YYYY-MM-DD) covering every imported row. */
  dateRange: { from: string; to: string } | null;
}

export interface ParseYnabRequest {
  fileContent: string;
}

export interface ParseYnabResponse {
  result: YnabParseResult;
}

/** Per-account decision the user confirms in the preview step. The wizard always
 *  creates fresh accounts, with no opt-in to merge into an existing app account.
 *  A skipped account keeps its `currencyCode` so unskipping restores the picker's
 *  value; the executor ignores it. */
export type YnabAccountMappingValue = { currencyCode: string; skip?: boolean };

/** Keyed by `YnabParseAccount.originalName`. */
export type YnabAccountMapping = Record<string, YnabAccountMappingValue>;

export interface ExecuteYnabRequest {
  fileContent: string;
  accountMapping: YnabAccountMapping;
}

export interface ExecuteYnabResponse {
  jobId: string;
}

/** YNAB import jobs use the shared import-job lifecycle. Re-exported under the
 *  YNAB-specific names so existing consumers keep working. */
export const YNAB_IMPORT_JOB_STATUSES = IMPORT_JOB_STATUSES;
export type YnabImportJobStatus = ImportJobStatus;

/** Cumulative numbers reported once the worker finishes. */
export interface YnabImportSummary {
  accountsCreated: number;
  /** Number of source accounts mapped to skip. Optional: retained results predate the field. */
  accountsSkipped?: number;
  categoriesCreated: number;
  payeesCreated: number;
  tagsCreated: number;
  transactionsImported: number;
  transfersImported: number;
  /** Split groups detected by the parser. Their child rows are counted in
   *  `transactionsImported`; this is a nudge for post-import cleanup. */
  splitsDetected: number;
  errors: { rowIndex: number; error: string }[];
}

/** Common counters every progress event carries. */
interface YnabImportProgressBase {
  jobId: string;
  /** Rows committed so far. Each transaction and each transfer counts as 1. */
  processedCount: number;
  /** Expected total — sum of transactions + transfers. */
  totalCount: number;
}

/** SSE payload + GET /status response share the same envelope. Discriminated
 *  over `status` so `summary` is guaranteed when completed and `error` is
 *  guaranteed when failed — callers narrow once and read straight through. */
export type YnabImportProgress =
  | (YnabImportProgressBase & { status: 'queued' | 'running' })
  | (YnabImportProgressBase & { status: 'completed'; summary: YnabImportSummary })
  | (YnabImportProgressBase & { status: 'failed'; error: string });
