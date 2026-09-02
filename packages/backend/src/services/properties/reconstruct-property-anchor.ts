import { TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { Money } from '@common/types/money';
import type Properties from '@models/properties.model';
import { findTransactions } from '@models/transactions-query';
import { format, parseISO } from 'date-fns';
import { Op } from 'sequelize';

import { computePropertyValue } from './compute-property-value';

interface ReconstructAnchorParams {
  property: Properties;
  /** Optional cutoff — only include revaluation txs ≤ this date. Defaults to now. */
  asOf?: Date;
}

interface ReconstructedAnchor {
  /** Anchor value at `date`, expressed in the property's account currency. */
  value: Money;
  /** yyyy-MM-dd. Date the anchor was set (purchase or latest revaluation ≤ cutoff). */
  date: string;
  /** True if any revaluation was applied; false if anchor is the original purchase. */
  hasOverrides: boolean;
}

/**
 * Walk the property's revaluation transactions forward from purchase, applying
 * each one's signed amount on top of the curve-projected value at that date.
 * Returns the final (anchor value, anchor date) — i.e. the post-tx value of the
 * latest revaluation, with all prior anchors collapsed into it.
 *
 * Used wherever the live `valueAnchor` field needs to be re-derived from tx
 * history rather than read directly: the AfterDestroy hook on Transactions
 * (when a revaluation is deleted) and the stats history calculator.
 */
export async function reconstructPropertyAnchor({
  property,
  asOf,
}: ReconstructAnchorParams): Promise<ReconstructedAnchor> {
  const cutoff = asOf ?? new Date();

  // Revaluations are written by the balance-adjustment flow, which stamps them as adjustments —
  // excluding those (the boundary's default) would erase every anchor after the purchase.
  const overrideTxs = await findTransactions({
    planned: 'exclude',
    access: 'unscoped-internal',
    balanceAdjustments: 'include',
    transfers: { natures: [TRANSACTION_TRANSFER_NATURE.transfer_out_wallet] },
    completeness: 'all',
    where: {
      accountId: property.accountId,
      time: { [Op.lte]: cutoff },
    },
    order: [
      ['time', 'ASC'],
      ['createdAt', 'ASC'],
    ],
  });

  let anchorValue = property.purchasePrice;
  let anchorDateStr = property.purchaseDate;
  const annualRatePct = Number(property.annualAppreciationRatePct);

  for (const tx of overrideTxs) {
    const txDateStr = format(tx.time, 'yyyy-MM-dd');

    const preTxValue = computePropertyValue({
      anchorValue,
      anchorDate: parseISO(anchorDateStr),
      asOf: parseISO(txDateStr),
      annualRatePct,
    });

    const signedAmountCents =
      tx.transactionType === TRANSACTION_TYPES.income ? tx.amount.toCents() : -tx.amount.toCents();

    anchorValue = Money.fromCents(preTxValue.toCents() + signedAmountCents);
    anchorDateStr = txDateStr;
  }

  return {
    value: anchorValue,
    date: anchorDateStr,
    hasOverrides: overrideTxs.length > 0,
  };
}
