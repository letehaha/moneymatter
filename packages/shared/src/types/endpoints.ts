import {
  AccountModel,
  CategoryModel,
  EntityLogoPayload,
  TransactionLocation,
  TransactionModel,
  TransactionTemplateModel,
} from './db-models';
import { ACCOUNT_CATEGORIES, ACCOUNT_STATUSES, TRANSACTION_TYPES } from './enums';
import { RecordId } from './record-id';

export type BodyPayload = {
  [key: string | number]: string | number | boolean | undefined;
};
/** Index signature for bodies whose keys accept an explicit `null` (clear the
 *  stored value) alongside "absent = leave alone". Separate from `BodyPayload`
 *  so nulls stay rejected on every other endpoint. */
export type NullableBodyPayload = {
  [key: string | number]: string | number | boolean | null | undefined;
};
export type QueryPayload = {
  [key: string]: string | number | boolean | undefined;
};

export interface CreateAccountBody extends NullableBodyPayload, EntityLogoPayload {
  accountCategory: AccountModel['accountCategory'];
  currencyCode: AccountModel['currencyCode'];
  name: AccountModel['name'];
  initialBalance: AccountModel['initialBalance'];
  creditLimit: AccountModel['creditLimit'];
  type?: AccountModel['type'];
}

export interface UpdateAccountBody extends NullableBodyPayload, EntityLogoPayload {
  accountCategory?: AccountModel['accountCategory'];
  name?: AccountModel['name'];
  currentBalance?: AccountModel['currentBalance'];
  creditLimit?: AccountModel['creditLimit'];
  status?: ACCOUNT_STATUSES;
  excludeFromStats?: boolean;
}

export interface GetBalanceHistoryPayload extends QueryPayload {
  accountId?: AccountModel['id'];
  // yyyy-mm-dd
  from?: string;
  // yyyy-mm-dd
  to?: string;
}

export interface GetTotalBalancePayload extends QueryPayload {
  date: string;
}

export interface GetSpendingCategoriesPayload extends QueryPayload {
  accountId?: AccountModel['id'];
  // yyyy-mm-dd
  from?: string;
  // yyyy-mm-dd
  to?: string;
  raw?: boolean;
}

export type SpendingStructure = { name: string; color: string; amount: number };
export type GetSpendingsByCategoriesReturnType = {
  [categoryId: RecordId]: SpendingStructure;
};

export type SpendingStructureByType = { name: string; color: string; income: number; expense: number };
export type GetSpendingsByCategoriesByTypeReturnType = {
  [categoryId: RecordId]: SpendingStructureByType;
};

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

export interface UnlinkTransferTransactionsBody {
  transferIds: string[];
}
// Array of income/expense pairs to link between each other. It's better to pass
// exactly exactly as described in the type, but in fact doesn't really matter
export interface LinkTransactionsBody {
  ids: [baseTxId: RecordId, destinationTxId: RecordId][];
}

export type BulkUpdateTagMode = 'add' | 'replace' | 'remove';

export interface BulkUpdateTransactionsBody {
  transactionIds: string[];
  categoryId?: RecordId;
  tagIds?: string[];
  tagMode?: BulkUpdateTagMode;
  note?: string;
  // Nullable: explicit `null` clears the Payee, undefined leaves it untouched.
  payeeId?: RecordId | null;
}

export interface BulkUpdateTransactionsResponse {
  updatedCount: number;
  updatedIds: string[];
}

// Backward compatibility aliases
export type BulkUpdateTransactionsCategoryBody = BulkUpdateTransactionsBody;
export type BulkUpdateTransactionsCategoryResponse = BulkUpdateTransactionsResponse;

export interface BulkDeleteTransactionsBody {
  transactionIds: string[];
}

export interface BulkDeleteTransactionsResponse {
  deletedCount: number;
  deletedIds: string[];
}

export interface ReconciliationRemoveBody {
  transactionIds: RecordId[];
}

export interface ReconciliationMergeBody {
  transactionIds: RecordId[];
  survivorId: RecordId;
}

export interface ReconciliationActionResponse {
  removedIds: RecordId[];
}

export interface ReconciliationRestoreBody {
  transactionIds: RecordId[];
}

export interface ReconciliationRestoreResponse {
  restoredIds: RecordId[];
}

export type ReconciliationHistoryEvent = {
  removedAt: string;
  transactions: TransactionModel[];
} & ({ type: 'merge'; survivor: TransactionModel } | { type: 'remove'; survivor: null });

export interface StuckPendingItem {
  transaction: TransactionModel;
  candidate: TransactionModel | null;
  canCheckWithBank: boolean;
  pendingDays: number;
}

export interface CheckStuckPendingBody {
  accountId: RecordId;
}

export interface CheckStuckPendingResponse {
  bookedCount: number;
  pendingCount: number;
}

export interface KeepAsBookedBody {
  transactionIds: RecordId[];
}

export interface KeepAsBookedResponse {
  updatedIds: RecordId[];
}

export type CreateCategoryBody = {
  name: CategoryModel['name'];
  color?: CategoryModel['color'];
  icon?: CategoryModel['icon'];
  parentId?: CategoryModel['parentId'];
};
export type CreateCategoryResponse = CategoryModel;

export type EditCategoryBody = Partial<Pick<CategoryModel, 'name' | 'color' | 'icon' | 'parentId'>>;
export type EditCategoryResponse = CategoryModel[];

export interface DeleteCategoryBody {
  replaceWithCategoryId?: RecordId;
}

export interface DeleteCategoryConflictResponse {
  transactionCount: number;
}

// Cash Flow Analytics
export type CashFlowGranularity = 'monthly' | 'biweekly' | 'weekly';

export interface GetCashFlowPayload extends QueryPayload {
  // yyyy-mm-dd (required)
  from: string;
  // yyyy-mm-dd (required)
  to: string;
  granularity: CashFlowGranularity;
  accountId?: AccountModel['id'];
  // Filter to specific categories (comma-separated IDs).
  categoryIds?: string;
}

// Category breakdown within a period
export interface CashFlowCategoryData {
  categoryId: RecordId;
  name: string;
  color: string;
  // Separate amounts by transaction type for proper filtering.
  // Refunds net against the side they reverse, so either can be negative — see CashFlowPeriodData.
  incomeAmount: number;
  expenseAmount: number;
}

export interface CashFlowPeriodData {
  // yyyy-mm-dd
  periodStart: string;
  // yyyy-mm-dd
  periodEnd: string;
  // Both are net of refunds and CAN BE NEGATIVE: a refund reduces the side it reverses in the
  // bucket the money moved, so a period holding a refund whose original purchase sits in an
  // earlier bucket reports negative expenses. netFlow is always income - expenses.
  income: number;
  expenses: number;
  netFlow: number;
  // Per-category breakdown, always sent: the categoryIds selection when given, otherwise root categories.
  // Lists only categories with data in some period of the range.
  categories?: CashFlowCategoryData[];
}

export interface GetCashFlowResponse {
  periods: CashFlowPeriodData[];
  totals: {
    // Net of refunds, so negative is possible — see CashFlowPeriodData.
    income: number;
    expenses: number;
    netFlow: number;
    // percentage (0-100)
    savingsRate: number;
  };
}

// Pivot Report Analytics
// A cross-tab of a row dimension (category / category+subcategory / payee / tag)
// against a time dimension (year / quarter / month / week), summing refAmount in
// the user's base currency. Deltas, heatmap intensity and sorting are derived on
// the client from the returned matrix.
// Single source of truth for the pivot enums. The Zod validators (request query + saved-view
// settings schema) build their `z.enum(...)` straight off these tuples, so adding a member here
// can't silently drift out of sync with what the API accepts.
export const PIVOT_GRANULARITIES = ['yearly', 'quarterly', 'monthly', 'weekly'] as const;
export type PivotGranularity = (typeof PIVOT_GRANULARITIES)[number];
export const PIVOT_ROW_DIMENSIONS = ['category', 'subcategory', 'payee', 'tag'] as const;
export type PivotRowDimension = (typeof PIVOT_ROW_DIMENSIONS)[number];
export const PIVOT_MEASURES = ['expense', 'income'] as const;
export type PivotMeasure = (typeof PIVOT_MEASURES)[number];

// Max length of a saved Pivot view's user-facing name. Shared by the backend Zod
// schema and the client-side input cap so both reject the same overflow rather
// than the client letting the user type a name the server will 400 on.
export const SAVED_PIVOT_VIEW_NAME_MAX_LENGTH = 120;

export interface GetPivotReportPayload extends QueryPayload {
  // yyyy-mm-dd (required)
  from: string;
  // yyyy-mm-dd (required)
  to: string;
  granularity: PivotGranularity;
  rowDimension: PivotRowDimension;
  measure: PivotMeasure;
  // Comma-separated filter IDs (all optional; omitted = no restriction).
  accountIds?: string;
  categoryIds?: string;
  payeeIds?: string;
}

// One time bucket = one column of the pivot grid.
export interface PivotColumn {
  // Stable identity used to key row values, e.g. '2025' | '2025-Q1' | '2025-03' | '2025-03-03'
  // (weekly keys are the week's Monday as yyyy-MM-dd).
  key: string;
  // yyyy-mm-dd (clamped to the requested range at the edges).
  periodStart: string;
  // yyyy-mm-dd
  periodEnd: string;
  // Non-localized default label ('2025', 'Q1 2025', 'Mar 2025', 'Wk of 2025-03-03').
  // The client may reformat/localize from periodStart + granularity.
  label: string;
}

export interface PivotRow {
  // categoryId | payeeId | tagId, or a synthetic bucket id for the residual row
  // ('uncategorized' | 'unassigned' | 'untagged').
  id: string;
  label: string;
  // Hex color when the dimension carries one (categories), else null.
  color: string | null;
  // Brand domain (e.g. "netflix.com") for the payee dimension, so the client can render the
  // payee's logo; null when the payee has no resolved logo. Absent for every other dimension.
  logoDomain?: string | null;
  // Custom monogram letters + '#rrggbb' background for the payee dimension, taking
  // priority over logoDomain when set. Absent for every other dimension.
  logoInitials?: string | null;
  logoColor?: string | null;
  // Subcategory child rows point at their parent row id; parents/flat rows are null.
  parentId: string | null;
  kind: 'flat' | 'parent' | 'child';
  // columnKey -> amount (decimal, base currency).
  values: Record<string, number>;
  // Row total across all columns (decimal).
  total: number;
}

export interface GetPivotReportResponse {
  columns: PivotColumn[];
  rows: PivotRow[];
  // columnKey -> total across all top-level rows (decimal).
  columnTotals: Record<string, number>;
  grandTotal: number;
  // Base/reference currency all amounts are expressed in.
  currencyCode: string;
}

// A saved Pivot Report "view": the full configuration a user pinned so they can reopen the same
// cross-tab later. Persisted in the user-settings JSONB (no dedicated table); the backend Zod
// schema (`ZodSavedPivotViewConfigSchema`) is asserted to infer exactly this shape, and the
// frontend re-exports these so both ends share one contract.
export interface SavedPivotViewConfig {
  rowDimension: PivotRowDimension;
  granularity: PivotGranularity;
  measure: PivotMeasure;
  // Explicit period range as `yyyy-MM-dd` strings.
  from: string;
  to: string;
  accountIds?: string[];
  categoryIds?: string[];
  payeeIds?: string[];
  heatmap: boolean;
  showDelta: boolean;
}

export interface SavedPivotView {
  id: string;
  name: string;
  config: SavedPivotViewConfig;
}

// Per-section visibility for the sidebar's Accounts panel (Bank Accounts is always shown and
// intentionally absent). Persisted in the user-settings JSONB; the backend Zod schema
// (`ZodSidebarSectionsSchema`) is asserted to infer exactly this shape, and the frontend
// re-exports it, so both ends share one contract and cannot drift.
export interface SidebarSectionsConfig {
  portfolios: boolean;
  ventures: boolean;
  vehicles: boolean;
  loans: boolean;
}

// How fiat amounts render their currency: `symbol` disambiguates (CA$, A$, SGD), `narrowSymbol`
// is what locals use (Rp, ₴, zł) but collapses every dollar to `$`. Persisted in the
// user-settings JSONB; the backend Zod enum is built straight off this tuple.
export const CURRENCY_DISPLAY_PREFERENCES = ['symbol', 'narrowSymbol'] as const;
export type CurrencyDisplayPreference = (typeof CURRENCY_DISPLAY_PREFERENCES)[number];

// Net Worth Drivers Analytics
// Splits net-worth growth per period into what the user saved (income - expenses,
// transfers excluded) versus what the market returned on their holdings, plus the
// holdings/cash composition at each period end. Cumulative running totals, the
// holdings share and the goal projection are all derived on the client from these
// per-bucket values.
// Single source of truth for the granularity enum — the backend Zod validator builds
// its `z.enum(...)` straight off this tuple, so it can't drift from what the API accepts.
export const NET_WORTH_DRIVERS_GRANULARITIES = ['monthly', 'quarterly', 'yearly'] as const;
export type NetWorthDriversGranularity = (typeof NET_WORTH_DRIVERS_GRANULARITIES)[number];

export interface GetNetWorthDriversPayload extends QueryPayload {
  // yyyy-mm-dd (required)
  from: string;
  // yyyy-mm-dd (required)
  to: string;
  granularity: NetWorthDriversGranularity;
  // Comma-separated portfolio IDs to scope the investment slice to (holdings,
  // portfolio cash, flows, growth). Optional; omitted/empty = every enabled
  // portfolio. Savings and account-level cash are user-wide and unaffected.
  portfolioIds?: string;
}

// One portfolio's growth within a single bucket. Decimal, user base currency.
export interface NetWorthDriversPortfolioSlice {
  portfolioId: string;
  // This portfolio's share of the bucket's `growth`. Signed: negative in a losing period.
  growth: number;
}

// Legend entry for the per-portfolio growth split: every in-scope portfolio with
// investment activity anywhere in the window.
export interface NetWorthDriversPortfolioMeta {
  portfolioId: string;
  name: string;
}

// Every amount below is a decimal in the user's base currency.
export interface NetWorthDriversBucket {
  // yyyy-mm-dd — clamped to the requested range, so the first and last bucket can
  // cover a partial period.
  periodStart: string;
  // yyyy-mm-dd
  periodEnd: string;
  savings: {
    income: number;
    // Positive number — the amount spent, not a negative signed value.
    expenses: number;
    net: number;
  };
  investments: {
    // priceEffect + dividends - feesAndTaxes. Signed: negative in a losing period.
    growth: number;
    // Market value moved by prices alone, with purchases and sales taken out.
    priceEffect: number;
    // Gross, before the dividend's own fee (which is counted in feesAndTaxes).
    dividends: number;
    // Trade-embedded fees plus standalone fee/tax rows. Positive number — a cost.
    feesAndTaxes: number;
    // Sparse per-portfolio split of `growth` — only portfolios with non-zero growth
    // this bucket. Slices sum to `growth` exactly. Read the top-level `portfolios`
    // list for the full, ordered legend.
    byPortfolio: NetWorthDriversPortfolioSlice[];
  };
  // Levels at periodEnd (not flows), used for the holdings-share cards.
  composition: {
    holdingsValue: number;
    // Cash accounts (credit-card negatives included) plus uninvested portfolio cash.
    cashValue: number;
  };
}

// One security whose holdings the report could not price.
export interface NetWorthDriversUnpricedSecurity {
  securityId: RecordId;
  // Label the security by `symbol ?? name ?? securityId` — both columns are
  // nullable, and an id shown to a user identifies nothing.
  symbol: string | null;
  name: string | null;
}

// What the report could not value truthfully. Two independent failures: a holding
// with no price is carried at cost, a currency with no rate converts at 1:1 — they
// distort different amounts and neither implies the other, so they stay apart.
export interface NetWorthDriversDegraded {
  // Tell the user these holdings had no price data in the range, so they are carried
  // at cost: `priceEffect` and `growth` for them are approximate — a bucket that also
  // holds a buy of one reads that trade's fee as a small gain — and
  // `composition.holdingsValue` may not reflect current value. Name them so the user
  // can fill in the prices that matter. Omitted when every holding priced.
  unpricedSecurities?: NetWorthDriversUnpricedSecurity[];
  // ISO codes that converted at a 1:1 placeholder. Warn that every amount touching
  // them is wrong by the true rate rather than presenting the totals as final.
  // Omitted when every currency resolved.
  fxFallbackCurrencies?: string[];
}

export interface GetNetWorthDriversResponse {
  buckets: NetWorthDriversBucket[];
  // Portfolios with investment activity anywhere in the window, ordered by absolute
  // total growth descending — a stable order so the client can assign each a
  // consistent colour across renders and fold the tail into "Others".
  portfolios: NetWorthDriversPortfolioMeta[];
  // Absent whenever the range valued cleanly, so a truthiness check on `degraded`
  // alone decides whether to render a data-quality warning. Present only when at
  // least one field inside it is non-empty — an empty object is never sent.
  degraded?: NetWorthDriversDegraded;
}

// Investment Contributions Analytics
// Per-period bars of the external cash a user moved into their portfolios, split by
// portfolio for a stacked chart. "Contribution" is money that crossed a portfolio's
// outer boundary — a deposit or an account→portfolio funding counts positive, a
// withdrawal counts negative. Market growth, dividends, buys/sells (cash↔holdings
// inside a portfolio) and portfolio↔portfolio moves are all excluded by construction,
// so the number is "money you added", never "money that grew".
// Single source of truth for the granularity enum — the backend Zod validator builds
// its `z.enum(...)` straight off this tuple, so it can't drift from what the API accepts.
export const INVESTMENT_CONTRIBUTIONS_GRANULARITIES = ['monthly', 'quarterly', 'yearly'] as const;
export type InvestmentContributionsGranularity = (typeof INVESTMENT_CONTRIBUTIONS_GRANULARITIES)[number];

export interface GetInvestmentContributionsPayload extends QueryPayload {
  // yyyy-mm-dd (required)
  from: string;
  // yyyy-mm-dd (required)
  to: string;
  granularity: InvestmentContributionsGranularity;
  // Comma-separated portfolio IDs to scope the contributions to. Optional; omitted or
  // empty = every enabled portfolio. Savings (below) is user-wide and unaffected.
  portfolioIds?: string;
}

// One portfolio's contribution within a single bucket. Decimal, user base currency.
export interface InvestmentContributionsPortfolioSlice {
  portfolioId: string;
  // Net external cash into this portfolio this bucket. Signed: negative when the
  // user withdrew more than they contributed in the period.
  amount: number;
}

export interface InvestmentContributionsBucket {
  // yyyy-mm-dd — clamped to the requested range, so the first and last bucket can
  // cover a partial period.
  periodStart: string;
  // yyyy-mm-dd
  periodEnd: string;
  // Sum of `byPortfolio` amounts — net contributions across the in-scope portfolios
  // this bucket. Signed.
  total: number;
  // Only portfolios with a non-zero net this bucket (sparse). Read the top-level
  // `portfolios` list for the full, ordered legend the stacked bars are built from.
  byPortfolio: InvestmentContributionsPortfolioSlice[];
  // User-wide income minus expenses this bucket (transfers excluded), for the
  // "share of savings" card. Not scoped by `portfolioIds`, so filtering to one
  // portfolio still compares its contributions against all money saved.
  savingsNet: number;
}

// Legend entry for the stacked chart: every portfolio that had contribution activity
// somewhere in the window.
export interface InvestmentContributionsPortfolioMeta {
  portfolioId: string;
  name: string;
}

export interface GetInvestmentContributionsResponse {
  buckets: InvestmentContributionsBucket[];
  // Portfolios that contributed anywhere in the window, ordered largest mover first —
  // a stable order so the client can assign each a consistent colour across renders.
  portfolios: InvestmentContributionsPortfolioMeta[];
}

// Venture Contributions
// Cash that left the user's accounts into venture deals within the window, read from
// the bank transactions linked to venture events. Decimal, user base currency, one row
// per deal ordered largest first; an income leg linked to a deal nets against it.
export interface GetVentureContributionsPayload extends QueryPayload {
  // yyyy-mm-dd (required)
  from: string;
  // yyyy-mm-dd (required)
  to: string;
}

export interface VentureContribution {
  dealId: string;
  name: string;
  amount: number;
}

export type GetVentureContributionsResponse = VentureContribution[];

// Net Worth History Analytics
// Mint-style assets/liabilities/net-worth series: every point is an end-of-bucket
// balance snapshot (a level, not a flow). The liability split is by account category
// with a per-account sign rule: a credit-card or overdraft account counts as a
// liability only while it is owing (negative balance) at that snapshot — one holding
// the user's own funds counts as assets instead. Loan accounts are always liabilities
// at their whole signed value. Everything else (regular accounts, portfolios,
// ventures, vehicles) counts as assets.
// The client derives filtered views (e.g. "average credit-card liabilities") from the
// per-kind values, so toggling kinds never refetches. The includeCreditLimitInStats
// setting is deliberately ignored here: net worth reflects actual balances, and
// available credit is not debt. Ranges producing more than `MAX_NET_WORTH_HISTORY_BUCKETS`
// buckets are rejected with 422 — the client must pick a coarser granularity.
// Single source of truth for the granularity enum — the backend Zod validator builds
// its `z.enum(...)` straight off this tuple, so it can't drift from what the API accepts.
export const NET_WORTH_HISTORY_GRANULARITIES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const;
export type NetWorthHistoryGranularity = (typeof NET_WORTH_HISTORY_GRANULARITIES)[number];

/** Max buckets a net-worth-history range may span before the API rejects it with 422. */
export const MAX_NET_WORTH_HISTORY_BUCKETS = 500;

// Account categories the report treats as debt products. A deliberate closed subset of
// ACCOUNT_CATEGORIES so the liability breakdown keys are a typed, exhaustive set.
export const NET_WORTH_LIABILITY_KINDS = [
  ACCOUNT_CATEGORIES.creditCard,
  ACCOUNT_CATEGORIES.loan,
  ACCOUNT_CATEGORIES.overdraft,
] as const;
export type NetWorthLiabilityKind = (typeof NET_WORTH_LIABILITY_KINDS)[number];

// Asset classes the report splits net-worth assets into. Report-specific rather than
// ACCOUNT_CATEGORIES values because vehicles and ventures are their own entities, and
// `cash` folds every deposit account (regular/savings/cash, plus a positive-balance
// card or overdraft) into one bucket. The client derives filtered views by toggling
// kinds, so it never refetches.
export const NET_WORTH_ASSET_KINDS = ['cash', 'investments', 'vehicles', 'ventures'] as const;
export type NetWorthAssetKind = (typeof NET_WORTH_ASSET_KINDS)[number];

export interface GetNetWorthHistoryPayload extends QueryPayload {
  // yyyy-mm-dd (required)
  from: string;
  // yyyy-mm-dd (required)
  to: string;
  granularity: NetWorthHistoryGranularity;
}

// Every amount below is a decimal in the user's base currency.
export interface NetWorthHistoryPoint {
  // yyyy-mm-dd — the bucket-end date the snapshot is taken at. The final bucket is
  // clamped to the requested `to`, so it can cover a partial period.
  date: string;
  // Balance per asset kind, keyed by `NET_WORTH_ASSET_KINDS`. `cash` is signed —
  // it folds every deposit account (an overdrawn one subtracts) plus any card or
  // overdraft holding a positive balance. `investments` is portfolios (holdings
  // plus uninvested cash); `vehicles` and `ventures` are their valued balances.
  assets: Record<NetWorthAssetKind, number>;
  // Sum of `assets` values.
  assetsTotal: number;
  // Balance per liability kind, keyed by account category. Credit-card and
  // overdraft are sums of their owing accounts only (always ≤ 0; a paid-off card
  // reads 0 and a positive-balance card moves to `assets.cash`). Loan is the whole
  // signed value, so an overpaid loan can read positive.
  liabilities: Record<NetWorthLiabilityKind, number>;
  // Sum of `liabilities` values. Signed, negative = owed.
  liabilitiesTotal: number;
  // assetsTotal + liabilitiesTotal.
  netWorth: number;
}

// One security whose holdings the report could not price on some snapshot days.
// Same shape as the net-worth-drivers report's: a holding with no price is carried
// at cost on those days, so its `assets.investments` understates market value.
export interface NetWorthHistoryUnpricedSecurity {
  securityId: RecordId;
  // Label the security by `symbol ?? name ?? securityId` — both columns are
  // nullable, and an id shown to a user identifies nothing.
  symbol: string | null;
  name: string | null;
}

// What the report could not value truthfully. Two independent failures: a holding
// with no price is carried at cost, a currency with no rate converts at 1:1 — they
// distort different amounts and neither implies the other, so they stay apart.
export interface NetWorthHistoryDegraded {
  // Holdings with no price data in the range, carried at cost — their contribution
  // to `assets.investments` understates market value. Omitted when every holding priced.
  unpricedSecurities?: NetWorthHistoryUnpricedSecurity[];
  // ISO codes that converted at a 1:1 placeholder — every amount touching them is
  // off by the true rate. Omitted when every currency resolved.
  fxFallbackCurrencies?: string[];
}

export interface GetNetWorthHistoryResponse {
  points: NetWorthHistoryPoint[];
  // Absent whenever the range valued cleanly, so a truthiness check on `degraded`
  // alone decides whether to render a data-quality warning. Present only when at
  // least one field inside it is non-empty — an empty object is never sent.
  degraded?: NetWorthHistoryDegraded;
}

// Cumulative Analytics (Trends Comparison)
export type CumulativeMetric = 'expenses' | 'income' | 'savings';

export interface GetCumulativePayload extends QueryPayload {
  // yyyy-mm-dd (required)
  from: string;
  // yyyy-mm-dd (required)
  to: string;
  metric: CumulativeMetric;
  accountId?: AccountModel['id'];
}

export interface CumulativeMonthData {
  month: number; // 1-12
  monthLabel: string; // "Jan", "Feb", etc.
  value: number; // cumulative value up to this month
  periodValue: number; // value for just this month
}

export interface CumulativePeriodData {
  year: number; // Year from the period start date (for reference)
  data: CumulativeMonthData[];
  total: number;
}

export interface GetCumulativeResponse {
  currentPeriod: CumulativePeriodData;
  previousPeriod: CumulativePeriodData;
  percentChange: number; // Period-over-period total change %
}

// Refund Recommendations
// Either transactionId OR (transactionType + originAmount + accountId) must be provided
export interface GetRefundRecommendationsQuery extends QueryPayload {
  // Option 1: Provide transaction ID - backend derives everything
  transactionId?: RecordId;
  // Option 2: Provide form data for new transactions
  // The transaction type to search for (opposite of current tx)
  transactionType?: TRANSACTION_TYPES;
  // Origin transaction amount (in decimal, not cents)
  originAmount?: number;
  // Account ID to derive currency for refAmount calculation
  accountId?: RecordId;
}

export type GetRefundRecommendationsResponse = TransactionModel[];

export type GetTransferRecommendationsResponse = TransactionModel[];

// Bulk Transfer Scan
export interface BulkTransferScanBody {
  from: string;
  to: string;
  limit?: number;
  offset?: number;
  includeOutOfWallet?: boolean;
}

export interface BulkTransferScanMatch {
  transaction: TransactionModel;
  confidence: number;
}

export interface BulkTransferScanItem {
  expense: TransactionModel;
  matches: BulkTransferScanMatch[];
}

export interface BulkTransferScanResponse {
  total: number;
  items: BulkTransferScanItem[];
}

// Transfer Suggestion Dismissals
export interface DismissTransferSuggestionBody {
  expenseTransactionId: RecordId;
  incomeTransactionId: RecordId;
}

// Budget Spending Stats
export interface BudgetSpendingByCategoryItem {
  categoryId: RecordId;
  name: string;
  color: string;
  amount: number; // decimal, positive (expenses only)
  children?: BudgetSpendingByCategoryItem[];
}

export interface BudgetSpendingPeriod {
  periodStart: string; // yyyy-MM-dd
  periodEnd: string;
  expense: number; // decimal, positive
  income: number; // decimal, positive
}

export interface BudgetSpendingStatsResponse {
  spendingsByCategory: BudgetSpendingByCategoryItem[];
  spendingOverTime: {
    granularity: 'monthly' | 'weekly';
    periods: BudgetSpendingPeriod[];
  };
}

// Exchange Rates
export interface ExchangeRatePairQuery extends QueryPayload {
  from: string;
  to: string;
  date: string; // yyyy-MM-dd
}

export interface ExchangeRatePairResponse {
  baseCode: string;
  quoteCode: string;
  /** ISO datetime of the rate actually used. Differs from the requested date when
   *  no rate existed for it and the nearest earlier one was substituted. */
  date: string;
  /** Quote units per 1 base unit: `toAmount = fromAmount * rate`. */
  rate: number;
  /** Present and true when the value is the user's own manual rate. */
  custom?: boolean;
}

export interface CreateTransactionTemplateBody {
  name: TransactionTemplateModel['name'];
  transactionType: TransactionTemplateModel['transactionType'];
  amount?: TransactionTemplateModel['amount'];
  accountId?: TransactionTemplateModel['accountId'];
  categoryId?: TransactionTemplateModel['categoryId'];
  payeeId?: TransactionTemplateModel['payeeId'];
  paymentType?: TransactionTemplateModel['paymentType'];
  note?: TransactionTemplateModel['note'];
  originalCurrencyCode?: TransactionTemplateModel['originalCurrencyCode'];
  /** Full replacement of the template's tag set. */
  tagIds?: TransactionTemplateModel['tagIds'];
}

/** `undefined` leaves a field unchanged, `null` clears it. */
export type UpdateTransactionTemplateBody = Partial<CreateTransactionTemplateBody>;
