/**
 * Import/Export shared types
 * These types are used by both frontend and backend for CSV import functionality
 */
import type { Cents } from './money';

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
 * One import batch in GET /import/batches-history. All transactions of a batch share a
 * single `importDetails.batchId`, so the id doubles as the filter for drilling into
 * GET /transactions?batchId=.
 */
export interface ImportBatchSummary {
  batchId: string;
  source: ImportSource;
  /** ISO timestamp shared by every transaction the batch created. */
  importedAt: string;
  transactionCount: number;
  /** Distinct account ids touched by the batch. */
  accountIds: string[];
  /** Accounts the import created; undo deletes each one that has no transactions left. */
  createdAccountCount: number;
}

/**
 * Response of GET /import/batches-history. `totalCount` is only filled on the first
 * page (`offset === 0`) and is `null` on every later one, same convention as
 * `AiCategorizationHistoryResponse`.
 */
export interface ImportBatchesHistoryResponse {
  items: ImportBatchSummary[];
  totalCount: number | null;
}

/** Synchronous response of DELETE /import/batch/:batchId. */
export interface DeleteImportBatchResponse {
  deletedCount: number;
  deletedIds: string[];
}

/** 202 response of DELETE /import/batch/:batchId when the batch is too large to
 *  delete synchronously: the delete runs as a background job that holds the
 *  app-wide write-lock until it finishes. */
export interface DeleteImportBatchQueuedResponse {
  jobId: string;
}

export type DeleteImportBatchResult = DeleteImportBatchResponse | DeleteImportBatchQueuedResponse;

/** Response of GET /import/batch-delete/status. Never 404s: "no job" is `idle`. */
export type ImportBatchDeleteActiveStatus =
  | { state: 'idle' }
  | { state: 'queued'; jobId: string }
  | { state: 'running'; jobId: string }
  | { state: 'completed'; jobId: string; deletedCount: number }
  | { state: 'failed'; jobId: string; error: string };

/** SSE payload of the batch-delete worker, in the shared import-queue shape. */
interface ImportBatchDeleteProgressBase {
  jobId: string;
  processedCount: number;
  totalCount: number;
}

export type ImportBatchDeleteProgress =
  | (ImportBatchDeleteProgressBase & { status: 'queued' | 'running' })
  | (ImportBatchDeleteProgressBase & { status: 'completed'; summary: { deletedCount: number } })
  | (ImportBatchDeleteProgressBase & { status: 'failed'; error: string });

export enum CategoryOptionValue {
  mapDataSourceColumn = 'map-data-source-column',
  createNewCategories = 'create-new-categories',
  existingCategory = 'existing-category',
}

export enum TagOptionValue {
  mapDataSourceColumn = 'map-data-source-column',
}

export enum CurrencyOptionValue {
  dataSourceColumn = 'data-source-column',
  existingCurrency = 'existing-currency',
}

export enum TransactionTypeOptionValue {
  dataSourceColumn = 'data-source-column',
  amountSign = 'amount-sign',
}

export enum AccountOptionValue {
  dataSourceColumn = 'data-source-column',
  existingAccount = 'existing-account',
}

/**
 * Category assignment options for CSV import
 */
export type CategoryOption =
  | { option: CategoryOptionValue.mapDataSourceColumn; columnName: string }
  | { option: CategoryOptionValue.createNewCategories; columnName: string }
  | { option: CategoryOptionValue.existingCategory; categoryId: string };

/**
 * Tag assignment options for CSV import. Currently supports mapping a CSV
 * column whose comma-separated cell values become individual tags on each row.
 * Absence of tags is expressed by setting the column-mapping field to `null`.
 */
export type TagOption = { option: TagOptionValue.mapDataSourceColumn; columnName: string };

/**
 * Currency assignment options for CSV import
 */
export type CurrencyOption =
  | { option: CurrencyOptionValue.dataSourceColumn; columnName: string }
  | { option: CurrencyOptionValue.existingCurrency; currencyCode: string };

/**
 * Transaction type determination options
 */
export type TransactionTypeOption =
  | {
      option: TransactionTypeOptionValue.dataSourceColumn;
      columnName: string;
      incomeValues: string[];
      expenseValues: string[];
    }
  | { option: TransactionTypeOptionValue.amountSign };

/**
 * Account assignment options for CSV import
 */
export type AccountOption =
  | { option: AccountOptionValue.dataSourceColumn; columnName: string }
  | { option: AccountOptionValue.existingAccount; accountId: string };

/**
 * Day/month order of the ambiguous d/d/yyyy date family (e.g. `12.01.2026`).
 * Chosen explicitly by the user in the import wizard — auto-detection only
 * pre-suggests, it never decides. Intrinsically ordered shapes (ISO,
 * ISO-datetime, compact YYYYMMDD) ignore it.
 */
export type DateFieldOrder = 'day-first' | 'month-first';

/**
 * Column mapping configuration for Step 2
 */
export interface ColumnMappingConfig {
  date: string;
  /** User-confirmed day/month order applied to the whole `date` column. */
  dateFieldOrder: DateFieldOrder;
  amount: string;
  description?: string;
  /** Optional CSV column whose value becomes `rawMerchantName` on the imported
   *  transaction — drives Payee extraction + `payee_rule` auto-categorization. */
  payee?: string;
  category: CategoryOption;
  /** Optional tag column mapping. `null` means no tags are imported. */
  tags?: TagOption | null;
  currency: CurrencyOption;
  transactionType: TransactionTypeOption;
  account: AccountOption;
}

/**
 * Source account with currency info extracted from CSV
 */
export interface SourceAccount {
  name: string;
  currency: string;
}

/**
 * Response from backend after validating Step 2 data
 */
export interface ExtractUniqueValuesResponse {
  sourceAccounts: SourceAccount[];
  sourceCategories: string[];
  /** Distinct tag strings found across all parsed rows, for populating the tag-mapping table. */
  sourceTags: string[];
  /** Currency mismatch warning when user selected existing account with different currency */
  currencyMismatchWarning?: string;
}

/**
 * Account mapping for import - maps CSV account name to action.
 * `currentBalance` (decimal, account currency) is the balance the created
 * account must hold AFTER the import — the execute step forces it as the
 * final `currentBalance`, absorbing the difference from the imported rows'
 * net into `initialBalance`. `null` leaves the balance at whatever the
 * imported rows sum to. Required-but-nullable (not optional) so every
 * create-new mapping states the balance explicitly, matching the Wallet
 * importer's `BudgetBakersWalletAccountMappingValue.currentBalance`.
 * `skip` excludes the source account and all of its rows from the import.
 */
export type AccountMappingValue =
  | { action: 'create-new'; currentBalance: number | null }
  | { action: 'link-existing'; accountId: string }
  | { action: 'skip' };

export type AccountMappingConfig = Record<string, AccountMappingValue>;

/**
 * Keyed by source category name; the value is the matched existing category id,
 * or null when the AI found no reasonable match.
 */
export interface AiMapImportCategoriesResponse {
  mappings: Record<string, string | null>;
}

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

/** A single row that cannot be priced by the exchange-rate layer. */
export interface UnpriceableRow {
  rowIndex: number;
  currencyCode: string;
}

/**
 * Tag mapping for import - maps a distinct source tag string to an action.
 * `skip` drops this source value rather than creating or linking a tag.
 */
export type TagMappingValue =
  | { action: 'create-new' }
  | { action: 'link-existing'; tagId: string }
  | { action: 'skip' };

/**
 * Maps each distinct source tag string to its import action.
 * Multiple source values may map to the same `tagId` — many-to-one is intentional.
 */
export type TagMappingConfig = Record<string, TagMappingValue>;

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
 * Invalid row with validation errors
 */
export interface InvalidRow {
  rowIndex: number;
  errors: string[];
  rawData: Record<string, string>;
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
 * Request for duplicate detection
 */
export interface DetectDuplicatesRequest {
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping: CategoryMappingConfig;
  tagMapping?: TagMappingConfig;
  /**
   * IANA timezone of the importing user's browser (e.g. `America/Montevideo`),
   * from `Intl.DateTimeFormat().resolvedOptions().timeZone`. Anchors date-only
   * and zone-less datetime cells to the right calendar day. Optional — absent or
   * invalid values fall back to UTC anchoring on the backend.
   */
  timezone?: string;
}

/**
 * Response from duplicate detection
 */
export interface DetectDuplicatesResponse {
  validRows: ParsedTransactionRow[];
  invalidRows: InvalidRow[];
  duplicates: DuplicateMatch[];
  /**
   * Rows whose currency has no stored exchange rate and is neither USD nor the
   * user's base currency. The preview layer uses this to offer skip/abort.
   * Only present when at least one such row exists.
   */
  unpriceableRows?: UnpriceableRow[];
}

/**
 * Request for import execution. The CSV execute step is asynchronous: the
 * request carries the raw `fileContent` + mapping (NOT pre-parsed `validRows`),
 * the server enqueues a background job and re-parses the file inside the worker
 * via the same `parseValidRows` the interactive detect-duplicates step uses.
 * `parseValidRows` is deterministic, so the skip indices the user picked against
 * the preview stay valid against the worker's fresh re-parse.
 */
export interface ExecuteImportRequest extends ImportExecuteRequestBase {
  fileContent: string;
  delimiter: string;
  columnMapping: ColumnMappingConfig;
  accountMapping: AccountMappingConfig;
  categoryMapping: CategoryMappingConfig;
  tagMapping?: TagMappingConfig;
  /** Row indices to skip (confirmed duplicates) */
  skipDuplicateIndices: number[];
  /**
   * Row indices for unpriceable rows the user chose to skip rather than abort.
   * Uses the same rowIndex space as skipDuplicateIndices and
   * DetectDuplicatesResponse.unpriceableRows[].rowIndex.
   */
  skipUnpriceableIndices?: number[];
  /** Fallback account for rows whose accountName is empty (used when "single existing account" was chosen) */
  defaultAccountId?: string;
  /** Fallback category for rows whose categoryName is empty (used when "single existing category" was chosen) */
  defaultCategoryId?: string;
  /**
   * IANA timezone of the importing user's browser. Forwarded to `parseValidRows`
   * so the worker anchors dates to the same instants the preview computed.
   */
  timezone?: string;
}

/**
 * The CSV execute endpoint enqueues a background job and returns its id. The
 * client follows progress over SSE (`CSV_IMPORT_PROGRESS`) and/or by polling the
 * status endpoint.
 */
export interface ExecuteImportResponse {
  jobId: string;
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

/**
 * Cumulative numbers the CSV import worker reports once it finishes. Carried in
 * the `completed` SSE event and the status endpoint's `completed` payload, so
 * `newTransactionIds`/`batchId` survive to the client without a separate fetch.
 */
export interface CsvImportSummary extends ImportSummaryBase {
  imported: number;
  /**
   * Rows that merged into an existing planned transaction instead of creating a
   * new one. Counted here instead of `imported`, and absent from
   * `newTransactionIds`. Optional for the same reason as
   * `accountBalanceChanges`: retained job results predating the field.
   */
  merged?: number;
  /** Number of duplicate rows skipped (from skipDuplicateIndices) */
  skipped: number;
  /** Number of unpriceable rows skipped (from skipUnpriceableIndices) */
  skippedUnpriceable: number;
  accountsCreated: number;
  /** Number of source accounts mapped to skip. Optional: retained results predate the field. */
  accountsSkipped?: number;
  categoriesCreated: number;
  tagsCreated: number;
  /** Number of Payees inserted by this import. Reused/linked Payees don't count. */
  payeesCreated: number;
  errors: ImportError[];
  /** Ids of every transaction created by this import. */
  newTransactionIds: string[];
  /** Batch id stamped on every imported transaction's import details. */
  batchId: string;
}

/** Common counters every CSV import progress event carries. */
interface CsvImportProgressBase {
  jobId: string;
  /** Rows committed so far — one tick per successfully created transaction. */
  processedCount: number;
  /** Expected total — the number of rows that will actually be imported. */
  totalCount: number;
}

/**
 * SSE payload and GET /status response share the same envelope. Discriminated
 * over `status` so `summary` is guaranteed when completed and `error` is
 * guaranteed when failed — callers narrow once and read straight through.
 */
export type CsvImportProgress =
  | (CsvImportProgressBase & { status: 'queued' | 'running' })
  | (CsvImportProgressBase & { status: 'completed'; summary: CsvImportSummary })
  | (CsvImportProgressBase & { status: 'failed'; error: string });
