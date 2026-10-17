import type { LoanBalanceHistoryPoint } from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { getLoanById } from '@services/loans/get-loan-by-id.service';
import { getPostAnchorPaymentLegs } from '@services/loans/get-post-anchor-payment-legs';
import { replayLoanOutstanding } from '@services/loans/replay-loan-outstanding';

/**
 * Outstanding-balance series of a loan in its native currency: the anchor
 * snapshot (`Accounts.initialBalance`, stored negative per the liability
 * convention) followed by one cumulative end-of-day point per day that has
 * payment legs. Mirrors the Balances-history rebuild in
 * `recompute-loan-balance.service` — same anchor-day grouping, same
 * floor-at-zero — but sums nominal `amount` instead of `refAmount`: the
 * Balances table stores base-currency figures, which cannot be plotted on a
 * loan-currency axis for foreign-currency loans.
 *
 * Throws NotFoundError when the loan doesn't exist, belongs to another user,
 * or the account isn't a loan (non-loan accounts have no LoanDetails sidecar).
 */
export const getLoanBalanceHistory = async ({
  userId,
  accountId,
}: {
  userId: number;
  accountId: string;
}): Promise<LoanBalanceHistoryPoint[]> => {
  const loanDetails = await getLoanById({ userId, accountId });
  const account = loanDetails.account;
  if (!account) {
    throw new Error('getLoanBalanceHistory: loanDetails.account is missing — include Accounts in the query');
  }

  const anchorDate = loanDetails.balanceAnchorDate;

  // Only DATE(time) >= anchor adjusts the outstanding; the anchor snapshot
  // already accounts for earlier payments.
  const legs = await getPostAnchorPaymentLegs({ loanAccountId: accountId, userId, anchorDate });

  // Native-currency figures: the Balances table stores base-currency amounts,
  // which cannot be plotted on a loan-currency axis for foreign-currency loans,
  // so this series sums each leg's nominal `amount` off the nominal anchor
  // snapshot (`Accounts.initialBalance`, stored negative per the liability
  // convention).
  const decimals = await getCurrencyDecimals({ userId, code: account.currencyCode });
  const series = replayLoanOutstanding({
    legs,
    anchorDate,
    openingBalance: account.initialBalance,
    decimals,
    pickMinor: ({ leg }) => leg.amount.toMinorUnits({ decimals }),
  });

  return series.map((point) => ({ date: point.date, amount: point.balance.toNumber() }));
};
