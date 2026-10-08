import type { Cents, InvestmentContributionsPortfolioMeta } from '@bt/shared/types';

/** One portfolio's net contribution within a single bucket, in base-currency cents. */
interface InvestmentContributionsPortfolioSliceCents {
  portfolioId: string;
  /** Signed: negative when the user withdrew more than they contributed this bucket. */
  amount: Cents;
}

/** Per-bucket result, all money in base-currency cents. */
interface InvestmentContributionsBucketCents {
  periodStart: string;
  periodEnd: string;
  /** Sum of `byPortfolio` amounts across the in-scope portfolios this bucket. Signed. */
  total: Cents;
  /** Only portfolios with a non-zero net this bucket (sparse). */
  byPortfolio: InvestmentContributionsPortfolioSliceCents[];
  /** User-wide income minus expenses this bucket (transfers excluded). Not scoped. */
  savingsNet: Cents;
}

export interface InvestmentContributionsResultCents {
  buckets: InvestmentContributionsBucketCents[];
  /**
   * Active portfolios ordered largest mover first; the serializer forwards this untouched.
   * Typed off the wire contract rather than restated here to keep the two from drifting.
   */
  portfolios: InvestmentContributionsPortfolioMeta[];
}
