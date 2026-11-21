import type { LoanApiResponse } from '@bt/shared/types';

/**
 * A loan as an assistant reads it: the account and loan-detail fields it can act on, without the
 * owner, bank link and logo fields of the account, the base-currency copies of the payment
 * amounts or audit timestamps. `currentBalance` keeps the liability convention (negative while
 * debt is outstanding). The timeline of events can be left out of a list.
 */
export function presentLoan({ loan, includeEvents = true }: { loan: LoanApiResponse; includeEvents?: boolean }) {
  const details = loan.loanDetails;

  return {
    id: loan.id,
    name: loan.name,
    currencyCode: loan.currencyCode,
    status: loan.status,
    excludeFromStats: loan.excludeFromStats,
    currentBalance: loan.currentBalance,
    refCurrentBalance: loan.refCurrentBalance,
    loanDetails: {
      loanType: details.loanType,
      originalPrincipal: details.originalPrincipal,
      interestRate: details.interestRate,
      termMonths: details.termMonths,
      startDate: details.startDate,
      balanceAnchorDate: details.balanceAnchorDate,
      minPayment: details.minPayment,
      plannedPayment: details.plannedPayment,
      paymentDayOfMonth: details.paymentDayOfMonth,
      lenderName: details.lenderName,
      accountNumber: details.accountNumber,
      ...(includeEvents && { events: details.events }),
    },
    projection: loan.projection,
    paymentsCount: loan.paymentsCount,
  };
}
