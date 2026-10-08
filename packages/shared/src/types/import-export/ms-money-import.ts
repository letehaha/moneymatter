/**
 * Shared contracts for the Microsoft Money (.mny) import pipeline. Lives in the
 * shared package so backend (decrypt, parse, queue, controllers) and frontend
 * (wizard UI, Pinia store, API client) stay in sync.
 *
 * Monetary values cross the wire as decimals — the convention for HTTP
 * boundaries in this codebase.
 *
 * Unlike the CSV-family importers, a `.mny` file is a binary database that is
 * uploaded once and parsed once. The parse result is cached server-side under
 * an `uploadId`; every later step references that id instead of re-sending the
 * file. See `MsMoneyUploadResponse`.
 */

import type { ResourceLease } from '../resource-lease';
import { TRANSACTION_TYPES } from '../transactions';
import { IMPORT_JOB_STATUSES } from './core';
import type {
  CategoryMappingConfig,
  DuplicateMatch,
  ImportError,
  ImportErrorCode,
  ImportExecuteRequestBase,
  ImportJobStatus,
  ImportSummaryBase,
} from './core';

/** Largest `.mny` upload accepted, in bytes. Money files grow with history;
 *  50MB covers a very long-running file while staying well inside what the
 *  API host can buffer without memory pressure. */
export const MS_MONEY_MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Hard cap on transactions the parser will surface, so one rogue file cannot
 *  exhaust memory building the preview. */
export const MS_MONEY_MAX_ROWS = 100_000;

/**
 * Tag attached to every voided row the import writes. A voided row lands at
 * amount 0, which makes it indistinguishable from an ordinary zero row in the
 * transactions list — the tag is what keeps it findable and filterable.
 */
export const MS_MONEY_VOID_TAG = { name: 'Void', color: '#64748B' } as const;

/** How long a parsed upload survives without a refresh. The wizard refreshes the
 *  lease while the user interacts, so this never has to cover a whole mapping
 *  session — but a hidden tab sends no heartbeat, so it does have to cover
 *  reading a statement in another tab partway through one. */
export const MS_MONEY_UPLOAD_IDLE_TTL_MS = 30 * 60 * 1000;

/** Ceiling on how long refreshing can keep an upload alive, so a wizard left
 *  open indefinitely still releases the parse result. */
export const MS_MONEY_UPLOAD_MAX_LIFETIME_MS = 4 * 60 * 60 * 1000;

/**
 * Money's internal account-type codes (`ACCT.at`). Values are Microsoft's, not
 * ours — they are read from the file and mapped to a support decision.
 */
export enum MsMoneyAccountType {
  banking = 0,
  creditCard = 1,
  cash = 2,
  asset = 3,
  liability = 4,
  investment = 5,
  loan = 6,
}

/**
 * Account types this importer brings across. Investment and loan accounts are
 * excluded: investments belong to the portfolios feature rather than the
 * transaction ledger, and loan accounts are a dedicated flow that rejects
 * imported rows. Both are reported as skip warnings instead of failing.
 */
export const MS_MONEY_SUPPORTED_ACCOUNT_TYPES: readonly MsMoneyAccountType[] = [
  MsMoneyAccountType.banking,
  MsMoneyAccountType.creditCard,
  MsMoneyAccountType.cash,
  MsMoneyAccountType.asset,
  MsMoneyAccountType.liability,
];

// ---------------------------------------------------------------------------
// Parse-result types (what the parser returns and the preview step renders)
// ---------------------------------------------------------------------------

/** An importable account discovered in the file. */
export interface MsMoneyParseAccount {
  /**
   * Money's account name (`ACCT.szFull`) — the join key in the mapping payload.
   * Unique per parse: blank names are synthesized (`Account {id}`) and collisions get a numeric suffix.
   */
  originalName: string;
  /** ISO code resolved through Money's currency table. */
  currency: string;
  accountType: MsMoneyAccountType;
  /** Rows belonging to this account, including transfer legs. Informational. */
  transactionCount: number;
  /** Signed sum of this account's imported rows. Never used to set a balance —
   *  the execute step derives those from the transactions it creates. */
  netImportedAmount: number;
}

/**
 * A category the file actually uses. Money categories are two levels deep under
 * fixed INCOME/EXPENSE roots, so a category is either a group (`groupName` null)
 * or a leaf inside one.
 */
export interface MsMoneyParseCategory {
  /** Full display path — `"Auto:Gas"` for a leaf, `"Auto"` for a group. This is
   *  the key used in `categoryMapping`. */
  fullName: string;
  /** Leaf name on its own (`"Gas"`). */
  name: string;
  /** Parent group name, or null when the category is itself a group. */
  groupName: string | null;
  transactionCount: number;
}

/** A payee referenced by at least one imported row. */
export interface MsMoneyParsePayee {
  name: string;
  transactionCount: number;
}

/**
 * One ordinary transaction, or an unpaired transfer leg imported as an
 * out-of-wallet transaction.
 *
 * Money stores split transactions as a parent row plus child rows carrying the
 * real per-category detail. The parser drops the parents and surfaces the
 * children as ordinary transactions, so `amount` here is always a leaf value.
 */
export interface MsMoneyParseTransaction {
  /** Stable index within this parse result. Duplicate-skip decisions reference it. */
  rowIndex: number;
  /** Money's own transaction id (`TRN.htrn`). Unique across the parse result. */
  sourceId: number;
  /** ISO instant. Money stores a plain calendar date, anchored here to UTC midnight. */
  date: string;
  accountName: string;
  /** Full category path, or null when the row is uncategorized or a transfer leg. */
  categoryName: string | null;
  payeeName: string | null;
  note: string;
  /** Signed decimal in the account's currency. Negative = expense. */
  amount: number;
  /** Direction taken from the sign of `amount`: negative is an expense, zero and
   *  positive are income. */
  type: TRANSACTION_TYPES;
  /** Money's check / reference number (`TRN.szId`), when present. */
  referenceNumber: string | null;
  /** True once the row was marked reconciled against a statement in Money. */
  reconciled: boolean;
  /** True when this is a transfer leg whose counterpart account is not being
   *  imported. Executed as `transfer_out_wallet`. Always false on voided rows. */
  outOfWallet: boolean;
  /** True when this row came from a split — it is one line of a larger
   *  transaction. */
  fromSplit: boolean;
  /**
   * True when Money marks the row void: the register entry is kept but never
   * applied to the balance. `amount` is 0 on these, and they are left out of the
   * import unless the user opts in via `includeVoidedTransactions`.
   */
  isVoid: boolean;
  /** Signed amount the row carried in Money before it was voided. Null on
   *  ordinary rows. */
  voidedAmount: number | null;
}

/**
 * A transfer between two imported accounts.
 *
 * Money records both legs and links them explicitly in its `TRN_XFER` table, so
 * pairing is exact — no amount/date heuristics are involved.
 */
export interface MsMoneyParseTransfer {
  /** Account the money leaves. */
  sourceAccountName: string;
  /** Account the money arrives in. */
  destinationAccountName: string;
  date: string;
  /** Positive decimal in `sourceCurrency`. */
  sourceAmount: number;
  /** Positive decimal in `destinationCurrency`. */
  destinationAmount: number;
  sourceCurrency: string;
  destinationCurrency: string;
  note: string;
  payeeName: string | null;
  /** Row indices of both legs, `[source, destination]`. */
  rowIndices: [number, number];
  /** Money's transaction ids for both legs. */
  sourceIds: [number, number];
}

/** Non-fatal parser observation surfaced in the preview step. */
export interface MsMoneyParseWarning {
  code:
    /** An account was skipped because its type is out of scope (investment/loan). */
    | 'account-type-unsupported'
    /** An account's currency was not in the file's currency table, so the import
     *  falls back to USD for it. */
    | 'account-currency-defaulted'
    /** An account carries no name in the file, so it is imported under a
     *  generated `Account <id>` name. Everything downstream keys on the account
     *  name, so a nameless account would otherwise take its rows with it. */
    | 'account-name-missing'
    /** Two or more accounts share one name in the file. The repeats are
     *  suffixed (`"Savings (2)"`) so they do not merge into a single account. */
    | 'account-name-duplicated'
    /** A row referenced an account that no longer exists in the file. */
    | 'orphan-row-skipped'
    /** A row was skipped because its date could not be read. */
    | 'row-missing-date'
    /** A row was skipped because its amount could not be read. Such a row is
     *  never imported at 0 — that would post a transaction moving nothing while
     *  the balance it belongs to silently comes up short. */
    | 'row-amount-unreadable'
    /** The file does not hold a table or column the parser asked for. Money's
     *  schema varies by version, and a missing table quietly empties a whole
     *  part of the import (no `TRN_XFER` = no transfers), so the specific
     *  tables and columns are named in `message`. */
    | 'file-schema-unexpected'
    /** A transfer leg's counterpart account is not being imported, so the leg
     *  imports as an out-of-wallet transaction instead. */
    | 'transfer-counterpart-not-imported'
    /** The file holds more rows than `MS_MONEY_MAX_ROWS`; the excess was dropped. */
    | 'row-limit-reached';
  message: string;
  /** How many rows/accounts this warning covers. Warnings are aggregated by
   *  code rather than emitted per row, so a file with 4,000 orphaned rows
   *  produces one warning, not 4,000. */
  count: number;
}

/** Cipher variant a `.mny` file was written with. Money changed it twice, and
 *  the decrypt path differs per variant. */
export type MsMoneyEncryption = 'new-sha1' | 'new-md5' | 'legacy-jet';

/** What the parser found, for rendering the preview step. */
export interface MsMoneyParseResult {
  accounts: MsMoneyParseAccount[];
  categories: MsMoneyParseCategory[];
  payees: MsMoneyParsePayee[];
  transactions: MsMoneyParseTransaction[];
  transfers: MsMoneyParseTransfer[];
  warnings: MsMoneyParseWarning[];
  /** ISO instant range covering every parsed row, or null when nothing parsed. */
  dateRange: { from: string; to: string } | null;
  /** The most-used account currency in the file. Money has no base-currency
   *  field, so this stands in for one; it is never used for maths. */
  baseCurrency: string | null;
  encryption: MsMoneyEncryption;
}

// ---------------------------------------------------------------------------
// Upload + parse
// ---------------------------------------------------------------------------

/**
 * Response to the binary upload. The file itself is not retained — only the
 * parse result, keyed by `uploadId` and scoped to the uploading user. Later
 * steps send that id, so a multi-megabyte database crosses the wire once.
 */
export interface MsMoneyUploadResponse {
  uploadId: string;
  result: MsMoneyParseResult;
  lease: ResourceLease;
}

// ---------------------------------------------------------------------------
// Account mapping (preview step → execute step decision)
// ---------------------------------------------------------------------------

/**
 * Per-account decision, discriminated on `action`:
 * - `create-new` — the import creates a fresh account. `currencyCode` comes
 *   from the file. `currentBalance` is the balance the account should show
 *   afterwards; null leaves it at the imported rows' net.
 * - `link-existing` — rows post to an existing account, whose pre-import
 *   balance is preserved. Only same-currency accounts are selectable.
 * - `skip` — the account and all its rows are left out of the import.
 */
export type MsMoneyAccountMappingValue =
  | { action: 'create-new'; currencyCode: string; currentBalance: number | null }
  | { action: 'link-existing'; accountId: string }
  | { action: 'skip' };

/** Keyed by `MsMoneyParseAccount.originalName`. */
export type MsMoneyAccountMapping = Record<string, MsMoneyAccountMappingValue>;

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export interface DetectMsMoneyDuplicatesRequest {
  uploadId: string;
  accountMapping: MsMoneyAccountMapping;
}

/** Only meaningful for `link-existing` accounts — a fresh account has no prior
 *  transactions to match against. */
export interface DetectMsMoneyDuplicatesResponse {
  duplicates: DuplicateMatch[];
}

// ---------------------------------------------------------------------------
// Execute
// ---------------------------------------------------------------------------

export interface ExecuteMsMoneyRequest extends ImportExecuteRequestBase {
  uploadId: string;
  accountMapping: MsMoneyAccountMapping;
  /** Keyed by `MsMoneyParseCategory.fullName`. Categories absent from this map
   *  import without a category rather than being silently created. */
  categoryMapping: CategoryMappingConfig;
  /** Row indices the user confirmed as duplicates and wants to skip. */
  skipDuplicateIndices: number[];
  /**
   * When true, rows Money marks void are written as zero-amount transactions
   * tagged {@link MS_MONEY_VOID_TAG}, preserving their date, payee, category,
   * memo and cheque number. When false/absent they are left out entirely.
   */
  includeVoidedTransactions?: boolean;
}

export interface ExecuteMsMoneyResponse {
  jobId: string;
}

// ---------------------------------------------------------------------------
// Job progress (SSE payload + GET /status response)
// ---------------------------------------------------------------------------

export const MS_MONEY_IMPORT_JOB_STATUSES = IMPORT_JOB_STATUSES;
export type MsMoneyImportJobStatus = ImportJobStatus;
export type MsMoneyImportErrorCode = ImportErrorCode;
export type MsMoneyImportError = ImportError;

/** Cumulative numbers reported once the worker finishes. */
export interface MsMoneyImportSummary extends ImportSummaryBase {
  accountsCreated: number;
  accountsLinked: number;
  accountsSkipped: number;
  categoriesCreated: number;
  payeesCreated: number;
  transactionsImported: number;
  transfersImported: number;
  /** Transfer legs whose counterpart account was not imported. */
  outOfWalletImported: number;
  /**
   * Voided rows written as zero-amount transactions. Counted here instead of in
   * `transactionsImported`, which stays a count of rows that moved money.
   *
   * Optional for the same reason as `accountBalanceChanges`: completed job
   * results are retained and replayed verbatim to /status pollers, so summaries
   * produced before this field existed do not carry it.
   */
  voidedImported?: number;
  /**
   * Rows that merged into an existing planned transaction instead of creating a
   * new one. Counted here instead of `transactionsImported`. Optional for the
   * same reason as `voidedImported`.
   */
  merged?: number;
  duplicatesSkipped: number;
  errors: MsMoneyImportError[];
}

interface MsMoneyImportProgressBase {
  jobId: string;
  /** Rows committed so far. Each transaction and each transfer counts as 1. */
  processedCount: number;
  /** Expected total — transactions plus transfers. */
  totalCount: number;
}

/** SSE payload and GET /status response share this envelope. Discriminated over
 *  `status` so `summary` is guaranteed when completed and `error` when failed. */
export type MsMoneyImportProgress =
  | (MsMoneyImportProgressBase & { status: 'queued' | 'running' })
  | (MsMoneyImportProgressBase & { status: 'completed'; summary: MsMoneyImportSummary })
  | (MsMoneyImportProgressBase & { status: 'failed'; error: string });
