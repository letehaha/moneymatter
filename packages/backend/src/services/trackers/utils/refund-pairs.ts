import type { RecordId } from '@bt/shared/types';
import { TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import RefundTransactions from '@models/refund-transactions.model';
import TransactionSplits from '@models/transaction-splits.model';
import { findTransactions } from '@models/transactions-query';
import { Op } from 'sequelize';

interface RefundTxData {
  id: string;
  refAmount: Money;
  transactionType: TRANSACTION_TYPES;
  time: Date;
  categoryId: RecordId;
}

export interface TrackerRefundPair {
  originalTx: RefundTxData;
  refundTx: RefundTxData;
  /**
   * When the refund targets a specific split of the original transaction, this is the split's
   * category. Callers should prefer this over `originalTx.categoryId` for category aggregation
   * so refunds attach to the split that was actually refunded (matching the global
   * "Expenses Structure" widget). Null when the refund applies to the whole transaction.
   */
  splitCategoryId: RecordId | null;
  /** True when originalTx was in `countedTransactions`, i.e. it contributed to the aggregation. */
  originalInScope: boolean;
  /** True when refundTx was in `countedTransactions`. */
  refundInScope: boolean;
}

/**
 * Fetches refund pairs for transactions counted in a tracker aggregation.
 *
 * Why: trackers aggregate transactions by manual linkage or category match without filtering
 * refunds. A refund-income inflates the income total and the matching expense reflects gross
 * spend instead of net. To match the global "Expenses Structure" widget, we net out the refund
 * leg on whichever side(s) of the pair are in the tracker.
 *
 * The returned pairs carry both transactions plus flags indicating which side(s) were counted,
 * so callers can decide where to apply `refundTx.refAmount` adjustments.
 *
 * Stats' `resolveRefundPairs` answers the same question for its own reports but hands back a pair
 * already oriented into expense/income sides; trackers keep the raw transactions because each call
 * site sorts the sides out differently.
 */
export const fetchTrackerRefundPairs = async ({
  countedTransactions,
}: {
  countedTransactions: { id: string; refundLinked: boolean }[];
}): Promise<TrackerRefundPair[]> => {
  const trackerTxIds = new Set(countedTransactions.map((t) => t.id));
  const txIdsWithRefunds = countedTransactions.filter((t) => t.refundLinked).map((t) => t.id);

  if (txIdsWithRefunds.length === 0) return [];

  const refunds = await RefundTransactions.findAll({
    where: {
      [Op.or]: [{ refundTxId: { [Op.in]: txIdsWithRefunds } }, { originalTxId: { [Op.in]: txIdsWithRefunds } }],
    },
  });

  if (refunds.length === 0) return [];

  const allRefundTxIds = new Set<string>();
  const splitIdsToFetch = new Set<string>();
  for (const refund of refunds) {
    if (refund.originalTxId) allRefundTxIds.add(refund.originalTxId);
    allRefundTxIds.add(refund.refundTxId);
    if (refund.splitId) splitIdsToFetch.add(refund.splitId);
  }

  // A refund link and both of its transactions always belong to one user, so scoping the lookup to
  // the links' owners keeps it inside the scope the counted rows came from. Planned rows never
  // count as a refund leg — tracker stats net money that actually moved.
  const [refundTxs, splits] = await Promise.all([
    findTransactions({
      planned: 'exclude',
      access: 'unscoped-internal',
      balanceAdjustments: 'include',
      completeness: 'all',
      where: {
        id: { [Op.in]: [...allRefundTxIds] },
        userId: { [Op.in]: [...new Set(refunds.map((refund) => refund.userId))] },
      },
      attributes: ['id', 'refAmount', 'transactionType', 'time', 'categoryId'],
    }),
    splitIdsToFetch.size > 0
      ? TransactionSplits.findAll({
          where: { id: { [Op.in]: [...splitIdsToFetch] } },
          attributes: ['id', 'categoryId'],
        })
      : Promise.resolve([] as TransactionSplits[]),
  ]);

  // A leg with no base-currency amount (custom currency, no rate yet) has nothing to net, so its pair drops out.
  const txById = new Map<string, RefundTxData>(
    refundTxs.flatMap((t) =>
      t.refAmount === null
        ? []
        : [
            [
              t.id,
              {
                id: t.id,
                refAmount: t.refAmount,
                transactionType: t.transactionType,
                time: t.time,
                categoryId: t.categoryId,
              },
            ] as const,
          ],
    ),
  );

  const splitCategoryById = new Map<string, RecordId>(splits.map((s) => [s.id, s.categoryId]));

  const pairs: TrackerRefundPair[] = [];
  for (const refund of refunds) {
    if (!refund.originalTxId) continue;
    const originalTx = txById.get(refund.originalTxId);
    const refundTx = txById.get(refund.refundTxId);
    if (!originalTx || !refundTx) continue;

    pairs.push({
      originalTx,
      refundTx,
      splitCategoryId: refund.splitId ? (splitCategoryById.get(refund.splitId) ?? null) : null,
      originalInScope: trackerTxIds.has(originalTx.id),
      refundInScope: trackerTxIds.has(refundTx.id),
    });
  }

  return pairs;
};
