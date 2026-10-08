import type { ACCOUNT_TYPES } from '../accounts';
import type { EmbeddedCategoryModel } from '../categories';
import type { CategorizationMeta } from '../categorization';
import { RecordId } from '../record-id';
import type { TagModel } from '../tags';

export enum PAYMENT_TYPES {
  bankTransfer = 'bankTransfer',
  voucher = 'voucher',
  webPayment = 'webPayment',
  cash = 'cash',
  mobilePayment = 'mobilePayment',
  creditCard = 'creditCard',
  debitCard = 'debitCard',
}

/**
 * Sortable fields for the transactions list. Name-based fields sort by the
 * related record's name (resolved backend-side via subquery), not by id.
 */
export enum TRANSACTION_SORT_FIELD {
  time = 'time',
  refAmount = 'refAmount',
  accountName = 'accountName',
  categoryName = 'categoryName',
  payeeName = 'payeeName',
  note = 'note',
  categorizationSource = 'categorizationSource',
}

export enum TRANSACTION_TYPES {
  income = 'income',
  expense = 'expense',
}

/** Pseudo-id accepted alongside real ids in `payeeIds` / `tagIds` list filters:
 * matches rows where the field is not set. */
export const BLANK_FILTER_VALUE = 'blank';

export enum FILTER_OPERATION {
  all = 'all',
  exclude = 'exclude',
  only = 'only',
}

// Stored like that in the DB as well
export enum TRANSACTION_TRANSFER_NATURE {
  not_transfer = 'not_transfer',
  common_transfer = 'transfer_between_user_accounts',
  transfer_out_wallet = 'transfer_out_wallet',
  transfer_to_portfolio = 'transfer_to_portfolio',
  transfer_to_venture = 'transfer_to_venture',
  transfer_to_loan = 'transfer_to_loan',
}

export interface TransactionSplitModel {
  id: RecordId;
  transactionId: RecordId;
  userId: number;
  categoryId: RecordId;
  amount: number;
  refAmount: number;
  note: string | null;
  category?: EmbeddedCategoryModel;
}

/**
 * Frozen identity of a transaction's original creator. Populated only when the creator's
 * Users row is being deleted – at that point we copy the last-known username/avatar before
 * the FK SET NULL nulls `Transactions.userId`. Lets the frontend render
 * "alice (deleted)" on shared-account transactions whose creator is gone instead of
 * an anonymous "Unknown user" placeholder.
 */
export interface TransactionCreatorSnapshot {
  userId: number;
  username: string;
  avatar: string | null;
}

export interface TransactionLocation {
  latitude: number;
  longitude: number;
}

export interface TransactionModel {
  id: RecordId;
  amount: number;
  // Amount in base currency
  refAmount: number;
  note: string;
  /** Link to an order page, booking confirmation, receipt, etc. http(s) only. */
  externalUrl: string | null;
  /** Order number, invoice number, booking reference, etc. */
  externalReference: string | null;
  /** Where the purchase happened. */
  location: TransactionLocation | null;
  time: Date;
  userId: number;
  /** See `TransactionCreatorSnapshot`. NULL on every row except when the creator's
   *  account is deleted; backfill is intentionally skipped (no historical
   *  user-deletes are retroactively recoverable). */
  creatorSnapshot: TransactionCreatorSnapshot | null;
  transactionType: TRANSACTION_TYPES;
  paymentType: PAYMENT_TYPES;
  accountId: RecordId;
  categoryId: RecordId;
  currencyCode: string;
  accountType: ACCOUNT_TYPES;
  refCurrencyCode: string;

  // is transaction transfer?
  transferNature: TRANSACTION_TRANSFER_NATURE;
  // (hash, used to connect two transactions)
  transferId: RecordId;

  originalId: string; // Stores the original id from external source
  externalData: object; // JSON of any addition fields
  // balance: number;
  // hold: boolean;
  // receiptId: RecordId;
  commissionRate: number; // should be comission calculated as refAmount
  refCommissionRate: number; // should be comission calculated as refAmount
  cashbackAmount: number; // add to unified
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  refundLinked: boolean;
  /** Serializer-derived, list reads only. */
  hasAttachments?: boolean;
  isPlanned: boolean;
  /** Serializer-derived: set when a bank transaction merged into this row while it was planned. */
  plannedMerge?: { mergedAt: string } | null;
  /** Serializer-derived: the bank has not booked this row yet. */
  isPending?: boolean;
  /** Metadata about how this transaction was categorized */
  categorizationMeta?: CategorizationMeta | null;
  /** Linked Payee. Null when no Payee resolved (raw merchant missing/unmatched). */
  payeeId?: RecordId | null;
  /**
   * Stops background Payee auto-linking from touching this row.
   *
   * Two auto-linkers run on every bank sync: the inline matcher that reads
   * the raw merchant string, and a fuzzy post-sync pass that re-tries
   * unlinked rows against the user's Payees + aliases. Both filter on
   * `payeeLocked = false`, so locked rows are invisible to them.
   *
   * Flips to `true` automatically when the user assigns or clears the
   * Payee in the UI. Prevents the next sync from undoing manual edits.
   *
   * Example: user sets a tx to Payee "Netflix Premium". Bank re-syncs the
   * same row with merchant "NETFLIX.COM"; without the lock the matcher
   * would revert it to plain "Netflix".
   *
   * `(payeeLocked: true, payeeId: null)` is valid – means "user deliberately
   * chose no payee here; don't auto-link one." Lock does not affect user
   * edits, categorization rules, or any other column.
   */
  payeeLocked?: boolean;
  /** Optional splits for multi-category transactions */
  splits?: TransactionSplitModel[];
  /** Optional tags associated with the transaction (loaded when includeTags=true) */
  tags?: TagModel[];
  /** Transaction groups this transaction belongs to (loaded when includeGroups=true).
   *  transactionCount is the group's full membership size, independent of how many of the
   *  group's members are in the current fetch window. */
  transactionGroups?: Array<{ id: RecordId; name: string; transactionCount: number }>;
  /** Recipient who attached this tx to a shared budget. Present (possibly `null`) on
   *  budget-scoped tx fetches; absent elsewhere. `null` ⇒ owner-attached, no chip in
   *  the UI. Non-null ⇒ the budget recipient who clicked Attach for this row. */
  addedBy?: { id: number; username: string; avatar: string | null } | null;
  /** Whether the caller has write access to this row. Set by list endpoints so the UI
   *  can render an inert details dialog (vs an edit form) when the row is visible –
   *  typically via a budget share – but not editable. Absent on write-result payloads
   *  and internal fetches; absent ⇒ "unknown / fall back to opportunistic UI". */
  canEdit?: boolean;
  /** Timestamp when the record was created (defaults to transaction time for existing records) */
  createdAt: Date;
  /** Timestamp when the record was last updated */
  updatedAt: Date;
}

export type GetTransactionsResponse = TransactionModel[];

/** One account's pending planned rows, aggregated. Deltas are decimals, income minus
 *  expenses — `plannedDelta` in the account currency, `refPlannedDelta` in the base one. */
export interface PlannedSummaryEntry {
  accountId: RecordId;
  currencyCode: string;
  plannedDelta: number;
  refPlannedDelta: number;
  count: number;
  /** ISO datetime of the furthest-out plan on the account. */
  latestTime: string;
}

export type GetPlannedSummaryResponse = PlannedSummaryEntry[];

/** Totals over every transaction matching the list filters, in base currency decimals.
 *  A transfer whose two legs both match counts once; transfers stay out of income/expense/net. */
export interface TransactionsSummaryResponse {
  count: number;
  income: number;
  expense: number;
  net: number;
  transfers: number;
}

/** Bulk target "everything matching these list filters, minus `excludedIds`". */
export interface BulkFilterSelection {
  /** The same query params the transactions list was fetched with. */
  filters: Record<string, unknown>;
  excludedIds?: string[];
}

/** A bulk action targets explicit ids or a filter selection, never both. */
export type BulkTarget =
  | { transactionIds: string[]; selection?: never }
  | { selection: BulkFilterSelection; transactionIds?: never };

export interface SplitInput {
  categoryId: RecordId;
  amount: number;
  note?: string | null;
}

export interface CreateTransactionBody {
  amount: TransactionModel['amount'];
  note?: TransactionModel['note'];
  externalUrl?: string;
  externalReference?: string;
  location?: TransactionLocation | null;
  time: string;
  transactionType: TransactionModel['transactionType'];
  paymentType: TransactionModel['paymentType'];
  accountId: TransactionModel['accountId'];
  categoryId?: TransactionModel['categoryId'];
  destinationAccountId?: TransactionModel['accountId'];
  destinationAmount?: TransactionModel['amount'];
  destinationTransactionId?: RecordId;
  commissionRate?: TransactionModel['commissionRate'];
  transferNature?: TransactionModel['transferNature'];
  // When transaction is being created, it can be marked as a refund for another transaction
  refundForTxId?: RecordId;
  // When refunding a split specifically (required when original tx has splits)
  refundForSplitId?: RecordId;
  // Optional splits for multi-category transactions
  splits?: SplitInput[];
  // Optional tag IDs to associate with the transaction
  tagIds?: string[];
  /** Pre-resolved Payee — typically null for manual creates; set by provider sync. */
  payeeId?: RecordId | null;
  /** True when the caller wants future syncs to leave this row's Payee link alone. */
  payeeLocked?: boolean;
  isPlanned?: boolean;
  /** Run the user's automations on a manual-account row; off by default. For API integrations. */
  applyAutomations?: boolean;
  originalAmount?: number;
  /** Any ISO 4217 code; it does not have to be connected to the user. */
  originalCurrencyCode?: string;
}

export interface UpdateTransactionBody {
  amount?: TransactionModel['amount'];
  destinationAmount?: TransactionModel['amount'];
  destinationTransactionId?: TransactionModel['id'];
  note?: TransactionModel['note'];
  /** `null` clears the field. */
  externalUrl?: string | null;
  externalReference?: string | null;
  location?: TransactionLocation | null;
  time?: string;
  transactionType?: TransactionModel['transactionType'];
  paymentType?: TransactionModel['paymentType'];
  accountId?: TransactionModel['accountId'];
  destinationAccountId?: TransactionModel['accountId'];
  categoryId?: TransactionModel['categoryId'];
  transferNature?: TransactionModel['transferNature'];
  // Pass tx id if you want to mark which tx it refunds
  refundsTxId?: RecordId | null;
  // When refunding a split specifically (required when original tx has splits)
  refundsSplitId?: RecordId | null;
  // Pass tx ids that will refund the source tx (with optional splitId for each)
  refundedByTxIds?: string[] | null;
  // Mapping of refundTxId -> splitId for split-specific refunds
  refundedBySplitIds?: Record<string, string> | null;
  // Optional splits for multi-category transactions (null to clear all splits)
  splits?: SplitInput[] | null;
  // Optional tag IDs to associate with the transaction (null to clear all tags)
  tagIds?: string[] | null;
  payeeId?: RecordId | null;
  payeeLocked?: boolean;
  isPlanned?: boolean;
  /** Send both fields as `null` to clear the pair. */
  originalAmount?: number | null;
  originalCurrencyCode?: string | null;
}

export const BULK_UPDATE_TAG_MODES = ['add', 'replace', 'remove'] as const;
export type BulkUpdateTagMode = (typeof BULK_UPDATE_TAG_MODES)[number];

export type BulkUpdateTransactionsBody = BulkTarget & {
  categoryId?: RecordId;
  tagIds?: string[];
  tagMode?: BulkUpdateTagMode;
  note?: string;
  // Nullable: explicit `null` clears the Payee, undefined leaves it untouched.
  payeeId?: RecordId | null;
};

export interface BulkUpdateTransactionsResponse {
  updatedCount: number;
  updatedIds: string[];
}

export type BulkDeleteTransactionsBody = BulkTarget;

export interface BulkDeleteTransactionsResponse {
  deletedCount: number;
  deletedIds: string[];
}

// Refund Recommendations
export type GetRefundRecommendationsResponse = TransactionModel[];

/**
 * A bank transaction merges into a planned one only when their dates are at most
 * this many days apart. The frontend uses it to flag plans whose window has passed.
 */
export const PLANNED_MATCH_WINDOW_DAYS = 7;
