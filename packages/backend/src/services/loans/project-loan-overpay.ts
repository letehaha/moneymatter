import { Money } from '@common/types/money';
import Accounts from '@models/accounts.model';
import { lockAccountRow } from '@services/accounts/lock-account-row';
import { getPostAnchorPaymentLegs } from '@services/loans/get-post-anchor-payment-legs';

/**
 * SELECT ... FOR UPDATE on a loan's account row within the ambient CLS
 * transaction. Concurrent payment writes would otherwise each read the same
 * pre-payment balance and jointly overpay the loan; serialising on this row is
 * what keeps a batch's balance projection consistent with what finally persists.
 * Returns `null` when no such row exists so the caller can raise its own
 * not-found error.
 */
export const lockLoanAccountRow = async ({
  loanAccountId,
  userId,
}: {
  loanAccountId: string;
  userId: number;
}): Promise<Accounts | null> => {
  return lockAccountRow({ accountId: loanAccountId, userId });
};

/**
 * Add loan amounts (balances, payment legs) in minor units at the loan currency's
 * decimals. A stored amount can carry finer digits than its currency: a row the
 * decimal-storage migration converted carries two decimals whatever the currency,
 * e.g. -1000.50 on a JPY loan. Each amount rounds half-up here, so the overpay
 * guards, the balance recompute, the settle date and the projection all read the
 * same outstanding.
 */
export const sumAtLoanDecimals = ({ amounts, decimals }: { amounts: Money[]; decimals: number }): Money =>
  Money.fromMinorUnits({
    value: amounts.reduce((sum, amount) => sum + amount.toMinorUnits({ decimals }), 0),
    decimals,
  });

/**
 * Sum the loan's post-anchor payment legs in the loan's own currency — the
 * income legs dated on/after `anchorDate` that the balance recompute folds into
 * the outstanding. Used to project the balance for a re-anchor before any write.
 */
export const sumPostAnchorPaymentLegs = async ({
  loanAccountId,
  userId,
  anchorDate,
  decimals,
}: {
  loanAccountId: string;
  userId: number;
  /** yyyy-MM-dd inclusive boundary. */
  anchorDate: string;
  /** Decimals of the loan currency. */
  decimals: number;
}): Promise<Money> => {
  const legs = await getPostAnchorPaymentLegs({ loanAccountId, userId, anchorDate });
  return sumAtLoanDecimals({ amounts: legs.map((leg) => leg.amount), decimals });
};

/**
 * Classify a projected loan balance against the "no credit" invariant. Loan
 * balances are negative (liability); income legs add toward zero, so a positive
 * projected balance means the payment overshoots the owed amount. The overpay
 * amount is that positive remainder (zero when the balance stays at/below zero).
 * Callers project with `sumAtLoanDecimals`, so the comparison matches the
 * recompute's zero floor.
 */
export const projectLoanOverpay = ({
  projectedBalance,
}: {
  projectedBalance: Money;
}): { projectedBalance: Money; overpaysBy: Money } => ({
  projectedBalance,
  overpaysBy: projectedBalance.isPositive() ? projectedBalance : Money.zero(),
});
