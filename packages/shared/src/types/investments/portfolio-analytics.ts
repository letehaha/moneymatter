import type { SECURITY_TYPE } from './enums';

/**
 * `GET /investments/portfolios/:id/analytics`. Money values are 2-dp decimal strings in `currencyCode`;
 * returns and weights are 8-dp decimal fractions (0.05 = 5%).
 */
export interface PortfolioAnalyticsModel {
  /** Same currency the value history reports in. */
  currencyCode: string;
  kpis: PortfolioAnalyticsKpisModel;
  /** Ascending by month. */
  monthlyMarketGain: PortfolioMonthlyMarketGainModel[];
  /** Descending by value. */
  holdings: PortfolioAnalyticsHoldingModel[];
  /** Daily time-weighted return, rebased to 0 at the period start. */
  portfolioReturnSeries: { date: string; value: string }[];
  allocation: PortfolioAllocationModel;
  /** Present when the request names a benchmark. */
  benchmark?: PortfolioBenchmarkSeriesModel;
}

export interface PortfolioAnalyticsKpisModel {
  /** Annualized XIRR since the first flow; null under 180 days of history or when it does not converge. */
  moneyWeightedReturn: string | null;
  /** Over the requested period. */
  timeWeightedReturn: string;
  /** Null while the time-weighted index never falls below an earlier peak. */
  maxDrawdown: PortfolioMaxDrawdownModel | null;
  feesPaid: PortfolioFeesPaidModel;
}

/** Fees on the period's transactions, at each transaction date's rate. */
export interface PortfolioFeesPaidModel {
  amount: string;
  /** Fees over the gross amount bought in the period; null without buys. */
  shareOfBuys: string | null;
}

export interface PortfolioMaxDrawdownModel {
  /** Negative fraction: -0.1 is a 10% drop from the peak. */
  value: string;
  /** YYYY-MM-DD */
  peakDate: string;
  /** YYYY-MM-DD */
  troughDate: string;
  /** First day the index is back at the peak; null while still below it. */
  recoveredDate: string | null;
}

export interface PortfolioMonthlyMarketGainModel {
  /** YYYY-MM */
  month: string;
  /** Value change over the month minus its net deposits. */
  gain: string;
}

export const PORTFOLIO_RETURN_PERIODS = ['1M', '3M', '6M', 'YTD', '1Y'] as const;
export type PortfolioReturnPeriod = (typeof PORTFOLIO_RETURN_PERIODS)[number];

export interface PortfolioAnalyticsHoldingModel {
  securityId: string;
  symbol: string | null;
  name: string | null;
  currencyCode: string;
  value: string;
  /** Share of the total portfolio value, cash included. */
  weight: string;
  /** Price return from the latest close on or before each anchor to the latest close; null without a close that far back. */
  returns: Record<PortfolioReturnPeriod, string | null>;
}

/** `PortfolioAllocationEntryModel.key` of cash in `byHolding` and `bySecurityType`. */
export const ALLOCATION_CASH_KEY = 'cash' as const;

export interface PortfolioAllocationEntryModel<K extends string = string> {
  /** A security id or `ALLOCATION_CASH_KEY`, a security type, or a currency code. */
  key: K;
  /** The security symbol in `byHolding`; null where `key` names itself. */
  label: string | null;
  value: string;
  weight: string;
}

export interface PortfolioAllocationModel {
  byHolding: PortfolioAllocationEntryModel[];
  /** A security with no reported type counts as `other`. */
  bySecurityType: PortfolioAllocationEntryModel<SECURITY_TYPE | typeof ALLOCATION_CASH_KEY>[];
  byCurrency: PortfolioAllocationEntryModel[];
}

/**
 * Dividend-including benchmarks. Where Yahoo has no usable total-return index, an accumulating
 * ETF tracking the index stands in (`isFundProxy`).
 */
export const PORTFOLIO_BENCHMARKS = {
  sp500: { name: 'S&P 500', providerSymbol: '^SP500TR', currencyCode: 'USD', isFundProxy: false },
  nasdaq100: { name: 'Nasdaq 100', providerSymbol: 'CNDX.L', currencyCode: 'USD', isFundProxy: true },
  msci_world: { name: 'MSCI World', providerSymbol: 'IWDA.AS', currencyCode: 'EUR', isFundProxy: true },
  euro_stoxx_50: { name: 'Euro Stoxx 50', providerSymbol: 'CSX5.AS', currencyCode: 'EUR', isFundProxy: true },
} as const;
export type PortfolioBenchmark = keyof typeof PORTFOLIO_BENCHMARKS;
export const PORTFOLIO_BENCHMARK_KEYS = Object.keys(PORTFOLIO_BENCHMARKS) as PortfolioBenchmark[];

export interface PortfolioBenchmarkSeriesModel {
  key: PortfolioBenchmark;
  /**
   * Daily return in the analytics currency, on the dates of `portfolioReturnSeries`. It starts at that
   * series' first value, so both lines leave the same point; when the benchmark's history starts later,
   * it joins the portfolio line on its first close. Empty while no prices are stored.
   */
  series: { date: string; value: string }[];
}
