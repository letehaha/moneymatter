import { INVESTMENT_TRANSACTION_CATEGORY } from '@bt/shared/types/investments';
import { Big } from 'big.js';

export interface HoldingTotalsLeg {
  category: INVESTMENT_TRANSACTION_CATEGORY;
  /** Signed share count for the leg (always positive in this model; direction comes from `category`). */
  quantity: Big;
  /** Cash moved by the leg in the holding's own currency; read only for buys, where it is price × quantity + fees. */
  amount: Big;
  /** Same as `amount`, expressed in the user's base currency. */
  refAmount: Big;
}

interface HoldingTotals {
  quantity: Big;
  costBasis: Big;
  refCostBasis: Big;
}

/**
 * Replays a holding's transactions into its current quantity and cost basis.
 *
 * Cost basis tracks the cost of the *current long position* only:
 * - While the running quantity is ≤ 0 there is no long position, so the basis
 *   is zero.
 * - A BUY that crosses from short/zero into long counts only the portion above
 *   zero; the rest merely covered the short.
 * - A BUY on top of an existing long position adds its full cost.
 * - A SELL reduces the basis proportionally to the shares remaining, and a SELL
 *   that drains the position to zero resets the basis. This is what makes a
 *   same-day wash sale (sell the whole position, then rebuy) keep only the
 *   rebuy lot.
 *
 * The replay is order-sensitive: `transactions` MUST be supplied in
 * chronological (date, then insertion) order. A rebuy seen before the sell that
 * liquidated the previous lots would blend their cost into the basis instead of
 * resetting it.
 *
 * NOTES:
 * - The `quantity ≤ 0 ⇒ basis 0` guard is load-bearing, not defensive: without
 *   it, a SELL taken while the running quantity is negative computes a negative
 *   `remaining / total` proportion and *adds* to the basis instead of reducing
 *   it, which can balloon the cost basis (e.g. crypto positions that drift
 *   negative on fee/staking rows).
 * - DIVIDEND and FEE legs intentionally affect neither quantity nor basis here;
 *   they are accounted for elsewhere.
 */
export const computeHoldingTotals = ({ transactions }: { transactions: HoldingTotalsLeg[] }): HoldingTotals => {
  let totalQuantity = new Big(0);
  let totalCostBasis = new Big(0);
  let totalRefCostBasis = new Big(0);

  for (const { category, quantity, amount, refAmount } of transactions) {
    switch (category) {
      case INVESTMENT_TRANSACTION_CATEGORY.buy: {
        const newQuantity = totalQuantity.plus(quantity);
        if (newQuantity.lte(0)) {
          // Still short after the buy — no long position to attribute cost to.
          totalCostBasis = new Big(0);
          totalRefCostBasis = new Big(0);
        } else if (totalQuantity.lte(0)) {
          // Crosses from short/zero into long; only the portion above zero is
          // new long basis, the rest covered the short.
          const longProportion = newQuantity.div(quantity);
          totalCostBasis = amount.times(longProportion);
          totalRefCostBasis = refAmount.times(longProportion);
        } else {
          totalCostBasis = totalCostBasis.plus(amount);
          totalRefCostBasis = totalRefCostBasis.plus(refAmount);
        }
        totalQuantity = newQuantity;
        break;
      }

      case INVESTMENT_TRANSACTION_CATEGORY.sell: {
        if (totalQuantity.gt(0)) {
          const newQuantity = totalQuantity.minus(quantity);
          if (newQuantity.lte(0)) {
            totalCostBasis = new Big(0);
            totalRefCostBasis = new Big(0);
          } else {
            const remainingProportion = newQuantity.div(totalQuantity);
            totalCostBasis = totalCostBasis.times(remainingProportion);
            totalRefCostBasis = totalRefCostBasis.times(remainingProportion);
          }
        }
        // Selling from a zero/short position leaves the basis untouched.
        totalQuantity = totalQuantity.minus(quantity);
        break;
      }

      // Categories that move neither the position nor its cost basis. Listed
      // exhaustively (with the default guard below) so a newly added category
      // fails to compile here until its effect is decided, rather than being
      // silently treated as a no-op.
      case INVESTMENT_TRANSACTION_CATEGORY.dividend:
      case INVESTMENT_TRANSACTION_CATEGORY.fee:
      case INVESTMENT_TRANSACTION_CATEGORY.transfer:
      case INVESTMENT_TRANSACTION_CATEGORY.tax:
      case INVESTMENT_TRANSACTION_CATEGORY.cancel:
      case INVESTMENT_TRANSACTION_CATEGORY.other:
        break;

      default: {
        // Exhaustiveness guard: erased at runtime (the column is a constrained
        // enum), but breaks the build if the enum gains a member.
        const exhaustiveCheck: never = category;
        return exhaustiveCheck;
      }
    }
  }

  // Cost basis floors at zero. The long-position replay above never yields a
  // negative basis, but clamp at the return so callers don't each re-apply it
  // (and so this matches the migration's frozen fold, which clamps the same way).
  return {
    quantity: totalQuantity,
    costBasis: totalCostBasis.lt(0) ? new Big(0) : totalCostBasis,
    refCostBasis: totalRefCostBasis.lt(0) ? new Big(0) : totalRefCostBasis,
  };
};
