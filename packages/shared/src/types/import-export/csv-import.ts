import type {
  CategoryMappingConfig,
  DateFieldOrder,
  DuplicateMatch,
  ImportError,
  ImportExecuteRequestBase,
  ImportSummaryBase,
  ParsedTransactionRow,
} from './core';

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
 * Invalid row with validation errors
 */
export interface InvalidRow {
  rowIndex: number;
  errors: string[];
  rawData: Record<string, string>;
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
