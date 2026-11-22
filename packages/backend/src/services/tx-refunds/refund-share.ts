import { Money } from '@common/types/money';

interface ShareLink {
  amount: Money | null;
}

interface ShareRefundTx {
  amount: Money;
  refAmount: Money;
}

export const refundShareAmount = ({
  link,
  refundTx,
}: {
  link: ShareLink;
  refundTx: Pick<ShareRefundTx, 'amount'>;
}): Money => link.amount ?? refundTx.amount;

// link_spans in services/budget-plans/activity/get-plan-activity.ts computes the same share and must change together with this.
/**
 * Base-currency value of a link's share, derived from the refund tx's refAmount so a base-currency change recomputes it.
 * Rounded half-up to `decimals`, the base currency's, once per link.
 */
export const refundShareRefAmount = ({
  link,
  refundTx,
  decimals,
}: {
  link: ShareLink;
  refundTx: ShareRefundTx;
  decimals: number;
}): Money => {
  if (link.amount === null) return refundTx.refAmount;
  if (refundTx.amount.isZero()) return Money.zero();
  return refundTx.refAmount.multiply(link.amount.toString()).divide(refundTx.amount.toString()).round(decimals);
};
