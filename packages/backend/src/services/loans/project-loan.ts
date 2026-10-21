import type { LoanProjection } from '@bt/shared/types';
import { getCurrencyDecimals } from '@common/lib/currency-precision';
import { computeLoanProjection } from '@common/loans/projection';
import type Accounts from '@models/accounts.model';
import type LoanDetails from '@models/loan-details.model';

// Adapter: feeds LoanDetails + Accounts into computeLoanProjection, keeping that
// module free of Sequelize types. currentBalance is stored negative (liability
// convention); the projection module wants a positive outstanding balance.
export async function projectLoan({
  loanDetails,
  account,
  today,
}: {
  loanDetails: LoanDetails;
  account: Accounts;
  today: Date;
}): Promise<LoanProjection> {
  const decimals = await getCurrencyDecimals({ userId: account.userId, code: account.currencyCode });
  // The stored balance is negative (liability) and floored at zero upstream, so
  // negating yields the positive outstanding the projection wants. Floor at zero
  // rather than abs: abs would render a stray credit as an equal amount of debt.
  const currentBalanceMinorUnits = Math.max(0, -account.currentBalance.toMinorUnits({ decimals }));
  const plannedPaymentMoney = loanDetails.plannedPayment;

  // Settle moment for a paid-off loan: `recomputeLoanBalance` stamps a
  // `paid_off` timeline event whose `at` is the date of the payment that
  // actually zeroed the balance, and strips stale events on reopen — so the
  // last live one is authoritative. A loan whose balance was already zero at
  // creation never transitions owing→settled and carries no event; its
  // balanceAnchorDate (the as-of date of that zero balance) is the best-known
  // settle date. Active loans ignore this input entirely.
  const paidOffEvent = (loanDetails.events ?? []).findLast((event) => event.type === 'paid_off');
  const settleDate = paidOffEvent?.at ?? loanDetails.balanceAnchorDate;

  return computeLoanProjection({
    currentBalanceMinorUnits,
    originalPrincipalMinorUnits: loanDetails.originalPrincipal.toMinorUnits({ decimals }),
    interestRate: loanDetails.interestRate,
    plannedPaymentMinorUnits: plannedPaymentMoney === null ? null : plannedPaymentMoney.toMinorUnits({ decimals }),
    termMonths: loanDetails.termMonths,
    startDate: loanDetails.startDate,
    settleDate,
    today,
    decimals,
  });
}
