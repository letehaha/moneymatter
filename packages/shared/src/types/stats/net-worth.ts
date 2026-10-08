import { ACCOUNT_CATEGORIES } from '../accounts';
import type { RecordId } from '../record-id';

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
  // ISO codes converted without a real rate for the day: at the currency's earliest
  // stored rate for dates before it, or 1:1 when none is stored. Warn that amounts
  // touching them are approximate rather than presenting the totals as final.
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
  // ISO codes converted without a real rate for the day: at the currency's earliest
  // stored rate for dates before it, or 1:1 when none is stored. Amounts touching
  // them are approximate. Omitted when every currency resolved.
  fxFallbackCurrencies?: string[];
}

export interface GetNetWorthHistoryResponse {
  points: NetWorthHistoryPoint[];
  // Absent whenever the range valued cleanly, so a truthiness check on `degraded`
  // alone decides whether to render a data-quality warning. Present only when at
  // least one field inside it is non-empty — an empty object is never sent.
  degraded?: NetWorthHistoryDegraded;
}
