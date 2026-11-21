import type { MinorUnits, NetWorthDriversDegraded, NetWorthDriversPortfolioMeta } from '@bt/shared/types';

import type { TransactionRow } from '../get-combined-balance-history/types';

/**
 * Raw (`raw: true`) investment-transaction row this report queries: the shared
 * replay projection plus `refFees`, which only the flow fold reads. Raw for the
 * same reason as the shared type — the full trade history loads here, and
 * hydrating Money fields per row is avoidable memory pressure.
 */
export type ReportTransactionRow = TransactionRow & {
  /** DECIMAL(20,10) string. Fee already folded into `refAmount`; split out per bucket. */
  refFees: string;
};

/**
 * Fields the per-bucket flow fold needs. Kept to the minimum the math reads so
 * the unit tests don't have to build whole transaction rows; the service's
 * actual query selects the wider set the shared holdings/cash replays require.
 */
export type InvestmentFlowRow = Pick<ReportTransactionRow, 'category' | 'date' | 'refAmount' | 'refFees'>;

/** Per-bucket investment cash flows, in base-currency minor units. */
export interface InvestmentFlowsMinor {
  /** Purchase notional (quantity x price), fees excluded. */
  buyNotional: MinorUnits;
  /** Sale notional (quantity x price), fees excluded. */
  sellNotional: MinorUnits;
  /** Dividend notional, before the dividend's own fee. */
  dividendsGross: MinorUnits;
  /** Every fee and tax that reduced the return: trade-embedded plus standalone rows. */
  feesAndTaxes: MinorUnits;
}

/** One portfolio's share of a bucket's investment growth, in base-currency minor units. */
export interface NetWorthDriversPortfolioSliceMinor {
  portfolioId: string;
  /** Signed: negative when the portfolio lost value over the bucket. */
  growth: MinorUnits;
}

/** Per-bucket result, all money in base-currency minor units. */
export interface NetWorthDriversBucketMinor {
  periodStart: string;
  periodEnd: string;
  savings: {
    income: MinorUnits;
    expenses: MinorUnits;
    net: MinorUnits;
  };
  investments: {
    growth: MinorUnits;
    priceEffect: MinorUnits;
    dividends: MinorUnits;
    feesAndTaxes: MinorUnits;
    /** Only portfolios with non-zero growth this bucket (sparse); sums to `growth` exactly. */
    byPortfolio: NetWorthDriversPortfolioSliceMinor[];
  };
  composition: {
    holdingsValue: MinorUnits;
    cashValue: MinorUnits;
  };
}

export interface NetWorthDriversResultMinor {
  buckets: NetWorthDriversBucketMinor[];
  /**
   * Active portfolios ordered largest absolute total growth first; the serializer
   * forwards this untouched. Typed off the wire contract rather than restated here
   * to keep the two from drifting.
   */
  portfolios: NetWorthDriversPortfolioMeta[];
  /**
   * Carries no money, so the serializer forwards it to the response as-is; typed
   * off the wire contract rather than restated here to keep the two from drifting.
   */
  degraded?: NetWorthDriversDegraded;
}
