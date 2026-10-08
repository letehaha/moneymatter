import type { Cents, NetWorthDriversDegraded, NetWorthDriversPortfolioMeta } from '@bt/shared/types';

import type { TransactionRow } from '../get-combined-balance-history/types';

/**
 * Raw (`raw: true`) investment-transaction row this report queries: the shared
 * replay projection plus `refFees`, which only the flow fold reads. Raw for the
 * same reason as the shared type — the full trade history loads here, and
 * hydrating Money fields per row is avoidable memory pressure.
 */
export type ReportTransactionRow = TransactionRow & {
  /** DECIMAL(20,10) string. Fee already embedded in `refAmount`; split out per bucket. */
  refFees: string;
};

/**
 * Fields the per-bucket flow fold needs. Kept to the minimum the math reads so
 * the unit tests don't have to build whole transaction rows; the service's
 * actual query selects the wider set the shared holdings/cash replays require.
 */
export type InvestmentFlowRow = Pick<ReportTransactionRow, 'category' | 'date' | 'refAmount' | 'refFees'>;

/** Per-bucket investment cash flows, in base-currency cents. */
export interface InvestmentFlowsCents {
  /** Purchase notional (quantity x price), fees excluded. */
  buyNotional: Cents;
  /** Sale notional (quantity x price), fees excluded. */
  sellNotional: Cents;
  /** Dividend notional, before the dividend's own fee. */
  dividendsGross: Cents;
  /** Every fee and tax that reduced the return: trade-embedded plus standalone rows. */
  feesAndTaxes: Cents;
}

/** One portfolio's share of a bucket's investment growth, in base-currency cents. */
export interface NetWorthDriversPortfolioSliceCents {
  portfolioId: string;
  /** Signed: negative when the portfolio lost value over the bucket. */
  growth: Cents;
}

/** Per-bucket result, all money in base-currency cents. */
export interface NetWorthDriversBucketCents {
  periodStart: string;
  periodEnd: string;
  savings: {
    income: Cents;
    expenses: Cents;
    net: Cents;
  };
  investments: {
    growth: Cents;
    priceEffect: Cents;
    dividends: Cents;
    feesAndTaxes: Cents;
    /** Only portfolios with non-zero growth this bucket (sparse); sums to `growth` exactly. */
    byPortfolio: NetWorthDriversPortfolioSliceCents[];
  };
  composition: {
    holdingsValue: Cents;
    cashValue: Cents;
  };
}

export interface NetWorthDriversResultCents {
  buckets: NetWorthDriversBucketCents[];
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
