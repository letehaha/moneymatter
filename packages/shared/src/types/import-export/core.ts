import type { Cents } from '../money';

/**
 * Maximum data rows accepted from a single CSV upload. Same cap applied on the
 * client (pre-flight in the investments column-mapping step) and on the server
 * (bank- and investment-import parsers). Bumping this in one place reflects
 * everywhere.
 */
export const MAX_CSV_ROWS = 50_000;

/**
 * CSV header names we refuse to accept — they would alias `Object.prototype`
 * keys when used as object indices downstream. Shared so client and server
 * stay in sync.
 */
export const CSV_FORBIDDEN_HEADERS = ['__proto__', 'prototype', 'constructor'] as const;

/**
 * Lifecycle states a background import job moves through, from enqueue to
 * terminal outcome. Shared across the per-provider import pipelines (YNAB,
 * Wallet, …) so their job-status types stay identical instead of each
 * redeclaring the same four strings.
 */
export const IMPORT_JOB_STATUSES = ['queued', 'running', 'completed', 'failed'] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

/**
 * Import source types for imported transactions
 */
export enum ImportSource {
  csv = 'csv',
  ynab = 'ynab',
  statementParser = 'statement-parser',
  budgetBakersWallet = 'budget-bakers-wallet',
  msMoney = 'ms-money',
  ofx = 'ofx',
}

/**
 * Import details stored in transaction's externalData for imported transactions.
 * This is undefined/null for manually created transactions or bank-synced transactions.
 */
export interface TransactionImportDetails {
  /** Unique identifier for the import batch - groups all transactions from a single import */
  batchId: string;
  /** ISO timestamp when the import was executed */
  importedAt: string;
  /** Source of the import */
  source: ImportSource;
}

/**
 * Day/month order of the ambiguous d/d/yyyy date family (e.g. `12.01.2026`).
 * Chosen explicitly by the user in the import wizard — auto-detection only
 * pre-suggests, it never decides. Intrinsically ordered shapes (ISO,
 * ISO-datetime, compact YYYYMMDD) ignore it.
 */
export type DateFieldOrder = 'day-first' | 'month-first';

/**
 * Category mapping for import - maps CSV category name to action
 */
export type CategoryMappingValue = { action: 'create-new' } | { action: 'link-existing'; categoryId: string };

export type CategoryMappingConfig = Record<string, CategoryMappingValue>;

/** Cap on remembered category presets per user — they all live in one settings row. */
export const MAX_CATEGORY_MAPPING_PRESETS = 20;

/**
 * A category mapping remembered from a finished import, so a later import from the
 * same source can re-apply it. One preset per fingerprint, newest wins.
 */
export interface CategoryMappingPreset {
  /**
   * Identifies a source layout: sha256 of the header row for CSV, a constant per
   * fixed-layout source otherwise.
   */
  fingerprint: string;
  /** User-given label. Named presets survive cap eviction and can be applied to any source. */
  name?: string;
  categoryMapping: CategoryMappingConfig;
  /** ISO timestamp of the import that wrote this preset. */
  updatedAt: string;
}

/**
 * Parsed transaction row ready for duplicate detection
 */
export interface ParsedTransactionRow {
  rowIndex: number;
  /** Stable provider transaction identifier, when the source supplies one. */
  originalId?: string;
  /**
   * ISO 8601 instant (e.g. `2026-06-01T15:00:00.000Z`) — the absolute moment the
   * transaction is stored at, already anchored to the importing user's timezone.
   * `execute-import` reconstructs it with `new Date(row.date)`.
   */
  date: string;
  amount: Cents;
  description: string;
  /** Raw value from the user-mapped Payee column, if mapping included one. */
  payeeName?: string;
  categoryName?: string;
  /** Tag strings split from the source tag cell (comma-delimited upstream). Absent when no tag column was mapped. */
  tagNames?: string[];
  accountName: string;
  currencyCode: string;
  transactionType: 'income' | 'expense';
}

/**
 * Duplicate match result
 */
export interface DuplicateMatch {
  rowIndex: number;
  importedTransaction: ParsedTransactionRow;
  existingTransaction: {
    id: string;
    date: string;
    amount: Cents;
    note: string;
    accountId: string;
  };
  matchType: 'originalId' | 'exact' | 'fuzzy';
  confidence: number; // 0-100
}

/**
 * Machine-recognizable import failure codes the UI special-cases.
 * `account-balance-desync`: an account's target balance could not be applied
 * after the rows landed, so its balance may now be wrong. Every coded failure
 * is account-level. Shared so each provider's importer (CSV, Wallet, …) draws
 * from one code set instead of redeclaring the literal.
 */
export type ImportErrorCode = 'account-balance-desync';

/**
 * Import error for a specific row (`rowIndex: number`) or an account-level
 * failure that maps to no single row (`rowIndex: null`). Discriminated so the
 * code implies the level: `account-balance-desync` — an account's target
 * balance could not be applied after the rows landed, so its balance may now
 * be wrong — is always account-level, and row-level errors never carry a code.
 */
export type ImportError =
  | { rowIndex: number; error: string; code?: undefined }
  | { rowIndex: null; error: string; code: ImportErrorCode };

/**
 * Per-account balance summary of an executed import, rendered in the done step.
 * All monetary values are decimals in the account's own currency. Accounts
 * created by the import (`isNewAccount: true`) have no pre-import balance to
 * compare against, so they carry no `balanceBefore`/`delta`.
 */
export type AccountBalanceChange = {
  accountId: string;
  accountName: string;
  /** Current balance after the import finished (including reconciliation). */
  balanceAfter: number;
  /** Rows classified as new (on/after the account's pre-import boundary day). */
  movedCount: number;
  /** Rows classified as backfill (older than the boundary day). */
  historicalCount: number;
} & (
  | { isNewAccount: true }
  | {
      isNewAccount: false;
      /** Current balance before the import wrote any rows. */
      balanceBefore: number;
      /** balanceAfter - balanceBefore. */
      delta: number;
    }
);

/**
 * Fields shared by every importer's execute request. Providers extend this so
 * the balance-recalculation contract stays identical across import pipelines.
 */
export interface ImportExecuteRequestBase {
  /**
   * When true, imported rows dated on/after a linked account's pre-import
   * boundary (day of its latest existing transaction) move that account's
   * current balance; older rows are absorbed into `initialBalance` (backfill).
   * When false/absent, every linked account keeps its pre-import balance.
   * Accounts created by the import always build their balance from their
   * starting balance + imported rows.
   *
   * Per-request override of the persisted default seeded from the
   * `import.recalculateAccountBalance` user setting
   * (`ZodImportSettingsSchema` in `user-settings.model.ts`); the wizard sends
   * the chosen value here and PATCHes the setting after the job is accepted.
   */
  recalculateBalance?: boolean;
}

/**
 * Fields shared by every importer's completion summary. Providers extend this
 * so the done-step balance section reads the same shape from each pipeline.
 */
export interface ImportSummaryBase {
  /**
   * How each touched account's current balance changed, per account. Optional
   * because completed job results are retained and replayed verbatim to /status
   * pollers — summaries produced before this field existed do not carry it.
   */
  accountBalanceChanges?: AccountBalanceChange[];
}
