import { type Cents, type InvestmentContributionsGranularity, type RecordId, asCents } from '@bt/shared/types';
import PortfolioTransfers from '@models/investments/portfolio-transfers.model';
import { withTransaction } from '@services/common/with-transaction';
import { fetchSavingsTransactions, generatePeriodBuckets, getScopedEnabledPortfolios } from '@services/stats/utils';
import { format } from 'date-fns';
import { Op } from 'sequelize';

import { accumulateContributions, accumulateSavingsNet, orderLegend } from './derivations';
import type { InvestmentContributionsResultCents } from './types';

export type { InvestmentContributionsResultCents } from './types';

interface GetInvestmentContributionsParams {
  userId: number;
  from: string;
  to: string;
  granularity: InvestmentContributionsGranularity;
  /**
   * Optional subset of the user's enabled portfolios to scope the contributions
   * to. The requested ids are intersected against the owned-and-enabled set in the
   * DB, so a foreign or disabled id never leaks through. Empty or absent includes
   * every enabled portfolio. Savings stays user-wide and unaffected by this filter.
   */
  portfolioIds?: RecordId[];
}

/**
 * Per-period bars of the external cash a user moved into their portfolios, split
 * by portfolio for a stacked chart.
 *
 * A contribution is money that crossed a portfolio's outer boundary, read only
 * from `PortfolioTransfers`: a deposit or account -> portfolio funding counts
 * positive, a withdrawal counts negative, and a portfolio<->portfolio move or a
 * same-portfolio currency exchange counts as nothing. Market growth, dividends and
 * buys/sells are cash<->holdings moves inside a portfolio (InvestmentTransactions,
 * never a PortfolioTransfer), so they are excluded by construction rather than by
 * subtraction — the number is "money you added", never "money that grew". A transfer
 * flagged `isAdjustment` is excluded too: it restates a balance rather than funding one.
 *
 * `savingsNet` rides alongside as the user-wide income-minus-expense per bucket for
 * the "share of savings" card, deliberately unscoped by `portfolioIds`.
 *
 * All amounts are base-currency cents; the serializer converts to decimals.
 */
export const getInvestmentContributions = async ({
  userId,
  from,
  to,
  granularity,
  portfolioIds,
}: GetInvestmentContributionsParams): Promise<InvestmentContributionsResultCents> => {
  const buckets = generatePeriodBuckets({ from, to, granularity });

  if (buckets.length === 0) {
    return { buckets: [], portfolios: [] };
  }

  // One read transaction pins a single Postgres connection across the fan-out
  // below, rather than each branch checking out its own connection.
  const { portfolios, transfers, savingsTransactions } = await withTransaction(async () => {
    const scopedPortfolios = await getScopedEnabledPortfolios({ userId, portfolioIds });

    const scopeIds = scopedPortfolios.map((portfolio) => portfolio.id);

    const [transferRows, savingsRows] = await Promise.all([
      // Only the scoped portfolios' boundary-crossing transfers. Skipped whole when
      // no portfolio is in scope — an `Op.in []` matches nothing yet still round-trips.
      // `refAmount` keeps its Money getter (no `raw`), and `date` is DATEONLY so the
      // string `Op.between` is an exact inclusive day range. Adjustments are dropped
      // here: they reconcile recorded cash to reality, so counting them would read a
      // correction as money the user contributed.
      scopeIds.length > 0
        ? PortfolioTransfers.findAll({
            where: {
              userId,
              isAdjustment: false,
              date: { [Op.between]: [from, to] },
              [Op.or]: [{ fromPortfolioId: { [Op.in]: scopeIds } }, { toPortfolioId: { [Op.in]: scopeIds } }],
            },
            attributes: ['fromPortfolioId', 'toPortfolioId', 'refAmount', 'date'],
          })
        : Promise.resolve([] as PortfolioTransfers[]),
      // Savings intake — real income and expense only, transfers dropped, user-wide.
      fetchSavingsTransactions({ userId, from, to }),
    ]);

    // Only the net of the intake is read here, and refund netting subtracts the same
    // amount from both sides of a bucket, so the resolved pairs cannot move it.
    return { portfolios: scopedPortfolios, transfers: transferRows, savingsTransactions: savingsRows.rows };
  })();

  const scope = new Set<string>(portfolios.map((portfolio) => portfolio.id));
  const nameById = new Map<string, string>(portfolios.map((portfolio) => [portfolio.id, portfolio.name]));

  const { byBucket, activePortfolioIds } = accumulateContributions({
    transfers: transfers.map((transfer) => ({
      fromPortfolioId: transfer.fromPortfolioId,
      toPortfolioId: transfer.toPortfolioId,
      refAmountCents: transfer.refAmount.toCents(),
      date: transfer.date,
    })),
    buckets,
    scope,
  });

  const savingsNet = accumulateSavingsNet({ transactions: savingsTransactions, buckets });

  const legend = orderLegend({ byBucket, activePortfolioIds, nameById });

  const resultBuckets = buckets.map((bucket, index) => {
    const bucketMap = byBucket[index]!;
    const byPortfolio: { portfolioId: string; amount: Cents }[] = [];
    let totalCents = 0;
    for (const [portfolioId, amount] of bucketMap) {
      if (amount === 0) continue;
      byPortfolio.push({ portfolioId, amount: asCents(amount) });
      totalCents += amount;
    }

    return {
      periodStart: format(bucket.periodStart, 'yyyy-MM-dd'),
      periodEnd: format(bucket.periodEnd, 'yyyy-MM-dd'),
      total: asCents(totalCents),
      byPortfolio,
      savingsNet: asCents(savingsNet[index]!),
    };
  });

  return { buckets: resultBuckets, portfolios: legend };
};
