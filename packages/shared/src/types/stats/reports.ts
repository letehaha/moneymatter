import type { AccountModel } from '../accounts';
import type { RecordId } from '../record-id';

export interface GetBalanceHistoryPayload {
  accountId?: AccountModel['id'];
  // yyyy-mm-dd
  from?: string;
  // yyyy-mm-dd
  to?: string;
}

export type SpendingStructure = { name: string; color: string; amount: number };
export type GetSpendingsByCategoriesReturnType = {
  [categoryId: RecordId]: SpendingStructure;
};

export type SpendingStructureByType = { name: string; color: string; income: number; expense: number };
export type GetSpendingsByCategoriesByTypeReturnType = {
  [categoryId: RecordId]: SpendingStructureByType;
};

// Cash Flow Analytics
export const CASH_FLOW_GRANULARITIES = ['monthly', 'biweekly', 'weekly'] as const;
export type CashFlowGranularity = (typeof CASH_FLOW_GRANULARITIES)[number];

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
export interface VentureContribution {
  dealId: string;
  name: string;
  amount: number;
}

export type GetVentureContributionsResponse = VentureContribution[];

// Cumulative Analytics (Trends Comparison)
export const CUMULATIVE_METRICS = ['expenses', 'income', 'savings'] as const;
export type CumulativeMetric = (typeof CUMULATIVE_METRICS)[number];

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
