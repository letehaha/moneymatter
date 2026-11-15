import { utcDayKey } from '@/common/utils/date';

/**
 * Max payment that keeps the loan at/above zero, as a positive decimal.
 * `loanCurrentBalance` is signed (liabilities negative); `existingLegAmount`
 * credits back an already-applied payment so editing it doesn't false-trip the guard.
 */
export const getMaxLoanPayment = ({
  loanCurrentBalance,
  existingLegAmount = 0,
}: {
  loanCurrentBalance: number;
  existingLegAmount?: number;
}): number => Math.abs(loanCurrentBalance) + existingLegAmount;

/**
 * True when `amount` would push the loan past a zero balance — i.e. pay off
 * more than is owed — beyond half a minor unit of the loan currency. The backend
 * compares amounts rounded to that unit, so the slack keeps an exact payoff valid
 * through float drift without letting a real overpay through.
 */
export const isLoanOverpayment = ({
  amount,
  maxPayment,
  decimals,
}: {
  amount: number;
  maxPayment: number;
  /** Decimals of the loan currency. */
  decimals: number;
}): boolean => Number.isFinite(amount) && amount > maxPayment + 0.5 * 10 ** -decimals;

/**
 * True when a payment dated strictly before the loan's balance anchor date —
 * such a payment is already baked into the opening snapshot and never enters the
 * post-anchor sum, so the backend exempts it from the overpay guard. Callers must
 * mirror that here so a legitimate pre-anchor backfill isn't blocked client-side.
 * Missing anchor (unknown) or missing date is treated as counted (not exempt).
 */
export const isLoanPaymentPreAnchor = ({
  paymentDate,
  balanceAnchorDate,
}: {
  paymentDate: Date | string | null | undefined;
  balanceAnchorDate: string | null | undefined;
}): boolean => {
  if (paymentDate == null || !balanceAnchorDate) return false;
  // UTC calendar day, not the browser-local day: the backend classifies legs via
  // SQL `DATE("time")` in a UTC database, and the two sides must agree for
  // timestamps near midnight in non-UTC browser timezones.
  return utcDayKey({ date: paymentDate }) < balanceAnchorDate;
};
