/**
 * Public contract for the user data-export pipeline.
 *
 * The pipeline produces a zip archive containing one file per "export domain"
 * plus a manifest. The output is intentionally lossy and human-readable –
 * foreign keys are denormalized to names, money becomes a decimal number, and
 * join/cache tables are absorbed into their parent. See README of this module
 * for the difference between Data Export and Backup/Restore.
 */

export {
  EXPORT_SCHEMA_VERSION,
  MAX_EXPORT_ROWS,
  type ExportDateRange,
  type ExportFileName,
  type ExportFormat,
  type ExportGroup,
} from '@bt/shared/types';

import {
  EXPORT_SCHEMA_VERSION,
  type ExportDateRange,
  type ExportFileName,
  type ExportFormat,
  type ExportGroup,
  type PAYMENT_TYPES,
  type RecordId,
} from '@bt/shared/types';

/** Input every export domain builder receives. */
export interface ExportBuildInput {
  userId: number;
  dateRange?: ExportDateRange;
  accountIds?: RecordId[];
}

/**
 * Final on-disk row shape per file. All keys map 1:1 to CSV column headers
 * (PascalCase) and to JSON property names (snake_case is the public form for
 * JSON, but we keep TypeScript fields in camelCase and translate at the
 * write boundary).
 */
export interface TransactionRow {
  date: string;
  time: string;
  account: string;
  type: 'income' | 'expense' | 'transfer_out' | 'transfer_in';
  paymentType: PAYMENT_TYPES;
  category: string;
  subcategory: string;
  payee: string;
  amount: number;
  currency: string;
  amountInBaseCurrency: number;
  baseCurrency: string;
  note: string;
  externalUrl: string;
  externalReference: string;
  /** `"<latitude>,<longitude>"`, empty when the transaction has no location. */
  location: string;
  tags: string[];
  splitDetails: string;
  splits: Array<{ category: string; amount: number; note: string }> | null;
  refundOf: string;
  linkedTransfer: string;
  subscription: string;
  isPlanned: boolean;
}

export interface AccountRow {
  name: string;
  type: string;
  currency: string;
  initialBalance: number;
  currentBalance: number;
  group: string;
  excludedFromStats: boolean;
  status: string;
  bankProvider: string;
}

export interface BalanceHistoryRow {
  account: string;
  date: string;
  balanceInBaseCurrency: number;
}

export interface CategoryRow {
  name: string;
  parentCategory: string;
  color: string;
  icon: string;
  isSystem: boolean;
}

export interface TagRow {
  name: string;
  description: string;
  color: string;
}

export interface PayeeRow {
  name: string;
  defaultCategory: string;
  aliases: string[];
  defaultTags: string[];
}

export interface VehicleRow {
  makeModel: string;
  year: number | null;
  linkedAccount: string;
  initialCost: number;
  /**
   * Null when the linked account FK does not resolve (account deleted or
   * cross-user reference filtered out by the transformer's userId guard).
   * Keeps the column in agreement with `linkedAccount`: when one shows the
   * unresolved sentinel, the other emits null instead of a blank cell that
   * reads as "no currency configured".
   */
  currency: string | null;
  currentMileage: number | null;
  depreciationModel: string;
}

export interface BudgetRow {
  name: string;
  status: string;
  periodStart: string;
  periodEnd: string;
  limitAmount: number | null;
  currency: string;
  categories: string[];
  tags: string[];
  spentAmount: number;
}

export interface SubscriptionRow {
  name: string;
  /**
   * Null when the subscription has no expected amount entered yet. Coercing
   * to 0 would print `0.00` in the export and read as "deliberate $0", losing
   * the distinction with an unknown price.
   */
  amount: number | null;
  currency: string;
  frequency: string;
  startDate: string;
  endDate: string;
  category: string;
  account: string;
  active: boolean;
  transactionType: string;
  linkedTransactionsCount: number;
}

export interface TransactionTemplateRow {
  name: string;
  type: string;
  amount: number | null;
  currency: string;
  account: string;
  category: string;
  payee: string;
  tags: string[];
  note: string;
}

export interface PortfolioRow {
  name: string;
  /**
   * Per-currency cash held in the portfolio. JSON consumers read this
   * structured form directly; CSV/XLSX consumers see the packed
   * `cashBalancesDetails` cell instead. Null when the portfolio has no
   * balance rows – distinct from an explicit zero balance, which renders as
   * `[{ currency, balance: 0 }]`.
   */
  cashBalances: Array<{ currency: string; balance: number }> | null;
  /**
   * Packed single-cell form of `cashBalances` for CSV/XLSX. Shape mirrors
   * the `splitDetails` pattern on transactions – `"USD: 1200.00 | EUR: 500.00"`,
   * empty string when the portfolio has no balance rows.
   */
  cashBalancesDetails: string;
  notes: string;
}

export interface HoldingRow {
  portfolio: string;
  securityTicker: string;
  securityName: string;
  quantity: number;
  costBasis: number;
  /**
   * Null when quantity is zero – keeps "closed position with residual cost
   * basis" distinguishable from a genuine zero. Writers render null as an
   * empty cell.
   */
  costBasisPerUnit: number | null;
}

export interface InvestmentTransactionRow {
  date: string;
  portfolio: string;
  security: string;
  type: string;
  quantity: number;
  price: number;
  fees: number;
  totalAmount: number;
  currency: string;
}

export interface PortfolioTransferRow {
  date: string;
  fromAccount: string;
  toAccount: string;
  amount: number;
  currency: string;
  note: string;
}

/**
 * Discriminated union of per-file output. Each transformer returns one of these.
 * The writer modules dispatch on `name` to pick column ordering and formatting.
 */
export type ExportTable =
  | { name: 'transactions'; rows: TransactionRow[] }
  | { name: 'accounts'; rows: AccountRow[] }
  | { name: 'balances_history'; rows: BalanceHistoryRow[] }
  | { name: 'categories'; rows: CategoryRow[] }
  | { name: 'tags'; rows: TagRow[] }
  | { name: 'payees'; rows: PayeeRow[] }
  | { name: 'vehicles'; rows: VehicleRow[] }
  | { name: 'budgets'; rows: BudgetRow[] }
  | { name: 'subscriptions'; rows: SubscriptionRow[] }
  | { name: 'transaction_templates'; rows: TransactionTemplateRow[] }
  | { name: 'portfolios'; rows: PortfolioRow[] }
  | { name: 'holdings'; rows: HoldingRow[] }
  | { name: 'investment_transactions'; rows: InvestmentTransactionRow[] }
  | { name: 'portfolio_transfers'; rows: PortfolioTransferRow[] };

/**
 * Closed set of filenames that may appear inside the export zip. Pinning the
 * literal union means a typo in a writer's filename surfaces as a compile
 * error rather than a manifest-validation mismatch at runtime.
 */
export type ExportArchiveFilename = `${ExportFileName}.csv` | 'data-export.json' | 'data-export.xlsx' | 'manifest.json';

export interface BuiltFile {
  filename: ExportArchiveFilename;
  buffer: Buffer;
  rowCount: number;
}

export interface ManifestFileEntry {
  filename: ExportArchiveFilename;
  sha256: string;
  sizeBytes: number;
  rowCount: number;
}

export interface ExportManifest {
  schemaVersion: typeof EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  format: ExportFormat;
  groups: ExportGroup[];
  /**
   * The closed date interval applied to event-table rows in this export.
   * Omitted when the request did not specify a range (i.e. the export covers
   * the full history). When present, at least one of `from` / `to` is set.
   * The date range never filters reference tables.
   */
  dateRange?: ExportDateRange;
  /**
   * The accounts this export was narrowed to, constraining transactions,
   * balance history and the accounts file. Omitted when the request asked for
   * every account.
   */
  accountIds?: RecordId[];
  files: ManifestFileEntry[];
}
