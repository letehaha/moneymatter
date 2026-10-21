import { createController } from '@controllers/helpers/controller-factory';
import { serializeLoans } from '@root/serializers/loans.serializer';
import { countLoanPaymentsByAccountIds } from '@services/loans/count-loan-payments.service';
import { getLoans } from '@services/loans/get-loans.service';
import { projectLoan } from '@services/loans/project-loan';
import { z } from 'zod';

export default createController(z.object({}), async ({ user }) => {
  const loanRecords = await getLoans({ userId: user.id });
  const today = new Date();

  const paymentCounts = await countLoanPaymentsByAccountIds({
    userId: user.id,
    accountIds: loanRecords.map((loanDetails) => loanDetails.accountId),
  });

  const decorated = await Promise.all(
    loanRecords.map(async (loanDetails) => ({
      loanDetails,
      projection: await projectLoan({ loanDetails, account: loanDetails.account, today }),
      paymentsCount: paymentCounts.get(loanDetails.accountId) ?? 0,
    })),
  );

  return { data: serializeLoans(decorated) };
});
