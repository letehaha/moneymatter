import type { MinorUnits, InvestmentContributionsPortfolioMeta } from '@bt/shared/types';

/** One portfolio's net contribution within a single bucket, in base-currency minor units. */
interface InvestmentContributionsPortfolioSliceMinor {
  portfolioId: string;
  /** Signed: negative when the user withdrew more than they contributed this bucket. */
  amount: MinorUnits;
}

/** Per-bucket result, all money in base-currency minor units. */
interface InvestmentContributionsBucketMinor {
  periodStart: string;
  periodEnd: string;
  /** Sum of `byPortfolio` amounts across the in-scope portfolios this bucket. Signed. */
  total: MinorUnits;
  /** Only portfolios with a non-zero net this bucket (sparse). */
  byPortfolio: InvestmentContributionsPortfolioSliceMinor[];
  /** User-wide income minus expenses this bucket (transfers excluded). Not scoped. */
  savingsNet: MinorUnits;
}

export interface InvestmentContributionsResultMinor {
  buckets: InvestmentContributionsBucketMinor[];
  /**
   * Active portfolios ordered largest mover first; the serializer forwards this untouched.
   * Typed off the wire contract rather than restated here to keep the two from drifting.
   */
  portfolios: InvestmentContributionsPortfolioMeta[];
}
