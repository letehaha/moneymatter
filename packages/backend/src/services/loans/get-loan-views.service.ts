import type { LoanApiResponse } from '@bt/shared/types';
import type LoanDetails from '@models/loan-details.model';
import { serializeLoan, serializeLoans } from '@root/serializers/loans.serializer';
import { countLoanPayments, countLoanPaymentsByAccountIds } from '@services/loans/count-loan-payments.service';
import { getLoanById } from '@services/loans/get-loan-by-id.service';
import { getLoans } from '@services/loans/get-loans.service';
import { projectLoan } from '@services/loans/project-loan';

/**
 * The loan as every reader sees it: the account, its loan details, the payoff projection as of
 * today and the payment count. `paymentsCount` is for a caller that already knows it (a loan that
 * was just created has none); without it the payments are counted.
 */
export const toLoanView = async ({
  userId,
  loanDetails,
  paymentsCount,
}: {
  userId: number;
  loanDetails: LoanDetails;
  paymentsCount?: number;
}): Promise<LoanApiResponse> => {
  const projection = await projectLoan({ loanDetails, account: loanDetails.account, today: new Date() });

  return serializeLoan({
    loanDetails,
    projection,
    paymentsCount: paymentsCount ?? (await countLoanPayments({ userId, accountId: loanDetails.accountId })),
  });
};

/** One loan of the user, or a not-found error. */
export const getLoanView = async ({
  userId,
  accountId,
}: {
  userId: number;
  accountId: string;
}): Promise<LoanApiResponse> => {
  const loanDetails = await getLoanById({ userId, accountId });
  return toLoanView({ userId, loanDetails });
};

/** Every loan of the user, newest first; the payments are counted in one query. */
export const getLoanViews = async ({ userId }: { userId: number }): Promise<LoanApiResponse[]> => {
  const loanRecords = await getLoans({ userId });
  const today = new Date();

  const paymentCounts = await countLoanPaymentsByAccountIds({
    userId,
    accountIds: loanRecords.map((loanDetails) => loanDetails.accountId),
  });

  const decorated = await Promise.all(
    loanRecords.map(async (loanDetails) => ({
      loanDetails,
      projection: await projectLoan({ loanDetails, account: loanDetails.account, today }),
      paymentsCount: paymentCounts.get(loanDetails.accountId) ?? 0,
    })),
  );

  return serializeLoans(decorated);
};
