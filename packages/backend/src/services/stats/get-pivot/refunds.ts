import { TRANSACTION_TYPES } from '@bt/shared/types';
import RefundTransactions from '@models/refund-transactions.model';
import Tags from '@models/tags.model';
import { findTransactions } from '@models/transactions-query';
import { Op } from 'sequelize';

/** A refund resolved for a whole-transaction dimension (payee / tag). */
interface WholeTxRefund {
  /** Payee of the original expense (the side that incurred the spend); null if unassigned. */
  payeeId: string | null;
  /** Tag ids of the original expense. Empty when the caller didn't request tags or it had none. */
  tagIds: string[];
  /** Refund magnitude in integer minor units of the base currency; callers subtract it. */
  refundMinor: number;
  /** The refund tx's own date, so the reduction lands in the bucket the money returned in. */
  refundTime: Date;
}

/**
 * Resolves refunds for the whole-transaction dimensions (payee, tag), which — unlike categories —
 * carry no per-split payee/tag. Each refund is attributed to the *original expense's* payee/tags
 * (the side that actually incurred the spend), so it cancels the same rows the expense filled,
 * mirroring how category netting attributes to the expense leg.
 *
 * The original + refund txs are loaded fresh (some sit outside the report window) with only the
 * attributes the caller's dimension needs.
 *
 * The category resolvers (`resolveRefundPairs`, `fetchTrackerRefundPairs`) can't stand in here:
 * they resolve a refund down to the split it targeted, and splits carry no payee or tag.
 */
export const resolveWholeTxRefunds = async ({
  transactions,
  needTags,
  decimals,
}: {
  transactions: { id: string; refundLinked: boolean }[];
  needTags: boolean;
  /** Decimals of the base currency: the scale the refund magnitudes are at. */
  decimals: number;
}): Promise<WholeTxRefund[]> => {
  const txIdsWithRefunds = transactions.filter((tx) => tx.refundLinked).map((tx) => tx.id);
  if (txIdsWithRefunds.length === 0) return [];

  const refunds = await RefundTransactions.findAll({
    where: {
      [Op.or]: [{ refundTxId: { [Op.in]: txIdsWithRefunds } }, { originalTxId: { [Op.in]: txIdsWithRefunds } }],
    },
  });
  if (refunds.length === 0) return [];

  const neededTxIds = new Set<string>();
  for (const refund of refunds) {
    if (refund.originalTxId) neededTxIds.add(refund.originalTxId);
    neededTxIds.add(refund.refundTxId);
  }

  // A refund link and both of its transactions always belong to one user, so scoping the lookup to
  // the links' owners keeps it inside the scope the caller's rows came from. Planned rows never
  // count as a refund leg — stats read money that actually moved.
  const txs = await findTransactions({
    planned: 'exclude',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    completeness: 'all',
    where: {
      id: { [Op.in]: [...neededTxIds] },
      userId: { [Op.in]: [...new Set(refunds.map((refund) => refund.userId))] },
    },
    attributes: ['id', 'refAmount', 'transactionType', 'payeeId', 'time'],
    include: needTags ? [{ model: Tags, through: { attributes: [] }, attributes: ['id'], required: false }] : [],
  });
  const byId = new Map(txs.map((tx) => [tx.id, tx]));

  const result: WholeTxRefund[] = [];
  for (const refund of refunds) {
    if (!refund.originalTxId) continue;
    const baseTx = byId.get(refund.originalTxId);
    const refundTx = byId.get(refund.refundTxId);
    if (!baseTx || !refundTx) continue;

    // Attribute to the expense side of the pair (mirrors the category netting's leg choice).
    const expenseSide = baseTx.transactionType === TRANSACTION_TYPES.expense ? baseTx : refundTx;
    result.push({
      payeeId: expenseSide.payeeId,
      tagIds: needTags ? (expenseSide.tags ?? []).map((tag) => tag.id) : [],
      refundMinor: refundTx.refAmount.toMinorUnits({ decimals }),
      refundTime: new Date(refundTx.time),
    });
  }

  return result;
};
