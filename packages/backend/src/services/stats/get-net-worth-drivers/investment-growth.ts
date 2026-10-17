import { type MinorUnits, INVESTMENT_TRANSACTION_CATEGORY, asMinorUnits } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { toUtcDateString } from '@common/utils/date';

import type { InvestmentFlowRow, InvestmentFlowsMinor, NetWorthDriversPortfolioSliceMinor } from './types';

/**
 * Bucket index for a UTC calendar day, or -1 when the day falls outside the
 * window.
 *
 * Deliberately resolved against the snapshot days rather than via
 * `findBucketIndex`: a trade counts in bucket `i` exactly when it settled in
 * `(boundary[i], boundary[i + 1]]` — the same span over which the holdings
 * snapshots moved. Bucketing the trade by one rule and the holdings delta by
 * another would let a trade dated on a period edge land on the wrong side of
 * its own price move, and the growth identity would silently break by that
 * trade's notional.
 */
const findBoundaryBucketIndex = ({ dayStr, boundaryDates }: { dayStr: string; boundaryDates: string[] }): number => {
  if (boundaryDates.length < 2) return -1;
  if (dayStr <= boundaryDates[0]! || dayStr > boundaryDates[boundaryDates.length - 1]!) return -1;

  return boundaryDates.findIndex((_, index) => index > 0 && dayStr <= boundaryDates[index]!) - 1;
};

/**
 * Per-bucket investment cash flows in base-currency minor units.
 *
 * `refAmount` is the cash moved: `notional + fees` for buy, `notional - fees`
 * for sell and dividend (see `resolveSettlement`). Each fee is collected once
 * into `feesAndTaxes`.
 * A standalone fee/tax row carries its cost in `refAmount` (its notional is
 * zero), hence the whole `refAmount` there.
 *
 * `transfer` / `cancel` / `other` move no cash (`calculateCashDelta` returns
 * null for them) and no shares, so they contribute nothing.
 */
export const accumulateInvestmentFlows = ({
  transactions,
  boundaryDates,
  decimals,
}: {
  transactions: InvestmentFlowRow[];
  boundaryDates: string[];
  /** Decimals of the base currency: the scale the amounts are converted to minor units at. */
  decimals: number;
}): InvestmentFlowsMinor[] => {
  const bucketCount = Math.max(boundaryDates.length - 1, 0);
  const flows: InvestmentFlowsMinor[] = Array.from({ length: bucketCount }, () => ({
    buyNotional: asMinorUnits(0),
    sellNotional: asMinorUnits(0),
    dividendsGross: asMinorUnits(0),
    feesAndTaxes: asMinorUnits(0),
  }));

  for (const tx of transactions) {
    const index = findBoundaryBucketIndex({ dayStr: toUtcDateString(tx.date), boundaryDates });
    if (index === -1) continue;

    const bucket = flows[index]!;
    // Raw rows carry DECIMAL strings; Money.fromDecimal is the same conversion
    // the model getter applies, so minor units come out identical to hydrated rows.
    const refAmount = Money.fromDecimal(tx.refAmount).toMinorUnits({ decimals });
    const refFees = Money.fromDecimal(tx.refFees).toMinorUnits({ decimals });

    switch (tx.category) {
      case INVESTMENT_TRANSACTION_CATEGORY.buy:
        bucket.buyNotional = asMinorUnits(bucket.buyNotional + refAmount - refFees);
        bucket.feesAndTaxes = asMinorUnits(bucket.feesAndTaxes + refFees);
        break;
      case INVESTMENT_TRANSACTION_CATEGORY.sell:
        bucket.sellNotional = asMinorUnits(bucket.sellNotional + refAmount + refFees);
        bucket.feesAndTaxes = asMinorUnits(bucket.feesAndTaxes + refFees);
        break;
      case INVESTMENT_TRANSACTION_CATEGORY.dividend:
        bucket.dividendsGross = asMinorUnits(bucket.dividendsGross + refAmount + refFees);
        bucket.feesAndTaxes = asMinorUnits(bucket.feesAndTaxes + refFees);
        break;
      case INVESTMENT_TRANSACTION_CATEGORY.fee:
      case INVESTMENT_TRANSACTION_CATEGORY.tax:
        bucket.feesAndTaxes = asMinorUnits(bucket.feesAndTaxes + refAmount);
        break;
      case INVESTMENT_TRANSACTION_CATEGORY.transfer:
      case INVESTMENT_TRANSACTION_CATEGORY.cancel:
      case INVESTMENT_TRANSACTION_CATEGORY.other:
        break;
      default: {
        // Exhaustiveness guard: a new category must have its effect on growth
        // decided here rather than silently counting as nothing.
        const exhaustiveCheck: never = tx.category;
        throw new Error(`Unhandled investment transaction category in accumulateInvestmentFlows: ${exhaustiveCheck}`);
      }
    }
  }

  return flows;
};

export interface InvestmentGrowthMinor {
  growth: MinorUnits;
  priceEffect: MinorUnits;
  dividends: MinorUnits;
  feesAndTaxes: MinorUnits;
}

/**
 * Split each bucket's holdings-value change into what prices did versus what the
 * user traded.
 *
 * Holdings value moves for exactly three reasons: prices moved, shares were
 * bought in, or shares were sold out. Taking the traded notionals out of the
 * change leaves the price effect on shares actually held — the "10 shares I owned
 * went from $100 to $150" number. Cash moving between an account and the
 * portfolio never enters this: it lands in portfolio cash, not in holdings, so
 * contributions are structurally excluded rather than subtracted out.
 *
 * `growth` equals `holdingsChange - netCashInvested` exactly, so the three
 * components always re-add to it.
 */
export const computeInvestmentGrowth = ({
  flows,
  holdingsMinorByDate,
  boundaryDates,
}: {
  flows: InvestmentFlowsMinor[];
  holdingsMinorByDate: Map<string, MinorUnits>;
  boundaryDates: string[];
}): InvestmentGrowthMinor[] =>
  flows.map((flow, index) => {
    const openingValue = holdingsMinorByDate.get(boundaryDates[index]!) ?? 0;
    const closingValue = holdingsMinorByDate.get(boundaryDates[index + 1]!) ?? 0;

    const priceEffect = asMinorUnits(closingValue - openingValue - flow.buyNotional + flow.sellNotional);
    const growth = asMinorUnits(priceEffect + flow.dividendsGross - flow.feesAndTaxes);

    return {
      growth,
      priceEffect,
      dividends: flow.dividendsGross,
      feesAndTaxes: flow.feesAndTaxes,
    };
  });

/** One portfolio's own growth series, positionally aligned with the report's buckets. */
export interface PortfolioGrowthSeries {
  portfolioId: string;
  name: string;
  growth: InvestmentGrowthMinor[];
  /**
   * Whether the portfolio held or traded anything in the window. Drives legend
   * membership only — a portfolio that held a flat position all window belongs in
   * the legend even though every bucket's growth is zero.
   */
  hasActivity: boolean;
}

/**
 * Collapse the per-portfolio growth series into the report's bucket totals plus the
 * sparse per-portfolio split of each bucket's `growth`.
 *
 * Every component is integer minor units and the totals are the elementwise sum of the
 * same series the slices are read from, so a bucket's slices re-add to its `growth`
 * exactly rather than to within a rounding step. Slices are emitted only where the
 * growth is non-zero, so a bucket a portfolio sat out carries no entry for it.
 *
 * The legend is ordered by the absolute size of each portfolio's signed growth
 * across every bucket (largest mover first) so the client can assign each a stable
 * colour; ties break on name A->Z.
 */
export const foldPortfolioGrowth = ({
  series,
  bucketCount,
}: {
  series: PortfolioGrowthSeries[];
  bucketCount: number;
}): {
  totals: InvestmentGrowthMinor[];
  byBucket: NetWorthDriversPortfolioSliceMinor[][];
  legend: { portfolioId: string; name: string }[];
} => {
  const totals: InvestmentGrowthMinor[] = Array.from({ length: bucketCount }, () => ({
    growth: asMinorUnits(0),
    priceEffect: asMinorUnits(0),
    dividends: asMinorUnits(0),
    feesAndTaxes: asMinorUnits(0),
  }));
  const byBucket: NetWorthDriversPortfolioSliceMinor[][] = Array.from({ length: bucketCount }, () => []);

  for (const entry of series) {
    for (let index = 0; index < bucketCount; index += 1) {
      const bucket = entry.growth[index];
      if (!bucket) continue;

      const total = totals[index]!;
      total.growth = asMinorUnits(total.growth + bucket.growth);
      total.priceEffect = asMinorUnits(total.priceEffect + bucket.priceEffect);
      total.dividends = asMinorUnits(total.dividends + bucket.dividends);
      total.feesAndTaxes = asMinorUnits(total.feesAndTaxes + bucket.feesAndTaxes);

      if (bucket.growth !== 0) {
        byBucket[index]!.push({ portfolioId: entry.portfolioId, growth: bucket.growth });
      }
    }
  }

  const legend = series
    .filter((entry) => entry.hasActivity)
    .map((entry) => ({
      portfolioId: entry.portfolioId,
      name: entry.name,
      signedTotal: entry.growth.reduce((sum, bucket) => sum + bucket.growth, 0),
    }))
    .toSorted((a, b) => {
      const magnitudeDiff = Math.abs(b.signedTotal) - Math.abs(a.signedTotal);
      if (magnitudeDiff !== 0) return magnitudeDiff;
      return a.name.localeCompare(b.name);
    })
    .map(({ portfolioId, name }) => ({ portfolioId, name }));

  return { totals, byBucket, legend };
};
