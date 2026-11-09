import { type Cents, asCents } from '@bt/shared/types';
import type { CategoryRefundPair } from '@services/stats/category-allocation';
import { type PeriodBucket, findBucketIndex } from '@services/stats/utils';

import { type SavingsTransactionRow, accumulateSavings } from '../get-net-worth-drivers/savings';

/** Portfolio-transfer fields the contribution fold reads, amount already in cents. */
interface ContributionTransferRow {
  fromPortfolioId: string | null;
  toPortfolioId: string | null;
  /** Net cash the transfer moved, in base-currency cents, always positive. */
  refAmountCents: Cents;
  /** DATEONLY `yyyy-MM-dd` — bucketed via `new Date(date)` to match the bucket edges. */
  date: string;
}

/**
 * Fold each portfolio transfer into its bucket as a signed net-cents delta: one
 * `portfolioId -> cents` map per bucket, positionally aligned with `buckets`.
 *
 * A transfer counts only when it crosses a portfolio's outer boundary:
 *  - inbound (+) when a scoped portfolio is the destination and there is no source
 *    portfolio (account -> portfolio funding, direct deposit);
 *  - outbound (-) when a scoped portfolio is the source and there is no destination
 *    portfolio (portfolio -> account withdrawal, direct withdrawal).
 * A transfer naming a portfolio on both sides never leaves the boundary — a
 * portfolio<->portfolio move or a same-portfolio currency exchange — so it is
 * skipped and reads as neither contribution nor withdrawal.
 *
 * `activePortfolioIds` is derived after the fold: a portfolio is active only when
 * its net is non-zero in at least one bucket, so a portfolio whose deposits and
 * withdrawals cancel to zero everywhere is left out of the legend entirely.
 *
 * `new Date(transfer.date)` on a DATEONLY string parses to that day's UTC
 * midnight, the same basis `generatePeriodBuckets` builds its edges on, so a
 * transfer lands in the bucket the requested range clamps its day to.
 */
export const accumulateContributions = ({
  transfers,
  buckets,
  scope,
}: {
  transfers: ContributionTransferRow[];
  buckets: PeriodBucket[];
  scope: Set<string>;
}): { byBucket: Map<string, Cents>[]; activePortfolioIds: Set<string> } => {
  const byBucket: Map<string, Cents>[] = buckets.map(() => new Map<string, Cents>());

  for (const transfer of transfers) {
    const inbound =
      transfer.toPortfolioId !== null && transfer.fromPortfolioId === null && scope.has(transfer.toPortfolioId);
    const outbound =
      transfer.fromPortfolioId !== null && transfer.toPortfolioId === null && scope.has(transfer.fromPortfolioId);

    let portfolioId: string;
    let delta: number;
    if (inbound) {
      portfolioId = transfer.toPortfolioId!;
      delta = transfer.refAmountCents;
    } else if (outbound) {
      portfolioId = transfer.fromPortfolioId!;
      delta = -transfer.refAmountCents;
    } else {
      // Both sides set, or the only scoped side is not the boundary-crossing one.
      continue;
    }

    if (delta === 0) continue;

    const bucketIndex = findBucketIndex({ transactionTime: new Date(transfer.date), buckets });
    if (bucketIndex === -1) continue;

    const bucketMap = byBucket[bucketIndex]!;
    bucketMap.set(portfolioId, asCents((bucketMap.get(portfolioId) ?? 0) + delta));
  }

  const activePortfolioIds = new Set<string>();
  for (const bucketMap of byBucket) {
    for (const [portfolioId, net] of bucketMap) {
      if (net !== 0) activePortfolioIds.add(portfolioId);
    }
  }

  return { byBucket, activePortfolioIds };
};

/**
 * Net income-minus-expense in base-currency cents per bucket, positionally aligned
 * with `buckets`. A thin projection of the net-worth-drivers savings fold, keeping
 * only its `net` so both reports bucket the same transactions the same way.
 * Transfers never reach here — the caller filters them at the query level — so this
 * is money that actually entered or left the user's finances, user-wide and
 * unaffected by any portfolio scope.
 */
export const accumulateSavingsNet = ({
  transactions,
  refundPairs,
  buckets,
}: {
  transactions: SavingsTransactionRow[];
  refundPairs: CategoryRefundPair[];
  buckets: PeriodBucket[];
}): Cents[] => accumulateSavings({ transactions, refundPairs, buckets }).map((bucket) => bucket.net);

/**
 * Legend for the stacked chart: one entry per active portfolio, ordered by the
 * absolute size of its signed total across every bucket (largest mover first) so
 * the client can assign each a stable colour. Ties break on name A->Z. A portfolio
 * absent from `activePortfolioIds` — net zero in every bucket — is dropped even if
 * `byBucket` still carries it with cancelling deltas.
 */
export const orderLegend = ({
  byBucket,
  activePortfolioIds,
  nameById,
}: {
  byBucket: Map<string, Cents>[];
  activePortfolioIds: Set<string>;
  nameById: Map<string, string>;
}): { portfolioId: string; name: string }[] => {
  const signedTotalById = new Map<string, number>();
  for (const bucketMap of byBucket) {
    for (const [portfolioId, net] of bucketMap) {
      signedTotalById.set(portfolioId, (signedTotalById.get(portfolioId) ?? 0) + net);
    }
  }

  return Array.from(activePortfolioIds, (portfolioId) => ({
    portfolioId,
    name: nameById.get(portfolioId) ?? portfolioId,
  })).toSorted((a, b) => {
    const magnitudeDiff =
      Math.abs(signedTotalById.get(b.portfolioId) ?? 0) - Math.abs(signedTotalById.get(a.portfolioId) ?? 0);
    if (magnitudeDiff !== 0) return magnitudeDiff;
    return a.name.localeCompare(b.name);
  });
};
