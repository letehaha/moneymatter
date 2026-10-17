import { ACCOUNT_CATEGORIES } from '@bt/shared/types';
import type { Money } from '@common/types/money';
import { t } from '@i18n/index';
import { NotFoundError, ValidationError } from '@js/errors';
import LoanDetails from '@models/loan-details.model';
import { isOnOrAfterAnchorDay } from '@services/loans/anchor-day';
import { lockLoanAccountRow, projectLoanOverpay } from '@services/loans/project-loan-overpay';

/**
 * Single home for the "institutional loans can't go into credit" invariant —
 * both `createOppositeTransaction` and `updateTransaction` delegate here.
 * SELECT ... FOR UPDATE on the loan account row: concurrent payment writes
 * would otherwise each read the same pre-payment balance and jointly overpay.
 * Loan balances are negative (liability); income legs add toward zero,
 * so a positive projected balance means overpay and the write is rejected.
 */
export const assertLoanPaymentAllowed = async ({
  ownerUserId,
  loanAccountId,
  newLegAmount,
  currentLegAmount = null,
  currentLegDate = null,
  paymentDate = null,
}: {
  ownerUserId: number;
  loanAccountId: string;
  /** Income-leg amount (in the loan account's currency) after the write lands. */
  newLegAmount: Money;
  /**
   * Amount of an existing income leg on THIS account that the write replaces.
   * Must stay `null` when re-pointing from a different account — that leg never
   * touched this balance, and backing it out would let an overpay through.
   */
  currentLegAmount?: Money | null;
  /**
   * Stored date of the `currentLegAmount` leg. A pre-anchor leg is not part of
   * `currentBalance` and must not be backed out of the projection. `null`
   * treats the leg as counted.
   */
  currentLegDate?: string | Date | null;
  /** Date the payment lands; pre-anchor payments skip the overpay guard. `null` keeps it active. */
  paymentDate?: string | Date | null;
}): Promise<void> => {
  const loanAccount = await lockLoanAccountRow({ loanAccountId, userId: ownerUserId });
  if (!loanAccount) {
    throw new NotFoundError({ message: t({ key: 'accounts.accountNotFoundForTransaction' }) });
  }
  if (loanAccount.accountCategory !== ACCOUNT_CATEGORIES.loan) {
    throw new ValidationError({
      message: t({ key: 'transactions.transferToLoanRequiresLoanDestination' }),
    });
  }

  const loanDetails = await LoanDetails.findOne({
    where: { accountId: loanAccountId },
    attributes: ['balanceAnchorDate'],
  });
  // Loan-category accounts without a LoanDetails sidecar (legacy mortgages,
  // plain accounts-endpoint creations) have no managed-balance machinery, so
  // the overpay guard doesn't apply.
  if (!loanDetails) return;

  // A leg counts toward `currentBalance` only when dated on/after the anchor
  // (UTC calendar day — the same day definition as the SQL `DATE(time)` filter
  // that feeds the balance recompute); pre-anchor legs are already baked into
  // the snapshot and stay informational.
  const isCounted = (date: string | Date | null) =>
    date == null || isOnOrAfterAnchorDay({ time: date, anchorDate: loanDetails.balanceAnchorDate });

  // A pre-anchor payment never enters the post-anchor sum, so it cannot overpay.
  if (paymentDate != null && !isCounted(paymentDate)) {
    return;
  }

  let rawProjectedBalance = loanAccount.currentBalance.add(newLegAmount);
  if (currentLegAmount !== null && isCounted(currentLegDate)) {
    rawProjectedBalance = rawProjectedBalance.subtract(currentLegAmount);
  }
  const { overpaysBy } = projectLoanOverpay({ projectedBalance: rawProjectedBalance });
  if (overpaysBy.isPositive()) {
    throw new ValidationError({
      message: t({ key: 'transactions.loanPaymentOverpay' }),
    });
  }
};
