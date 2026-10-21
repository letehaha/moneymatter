import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeLoan } from '@root/serializers/loans.serializer';
import { countLoanPayments } from '@services/loans/count-loan-payments.service';
import { getLoanById } from '@services/loans/get-loan-by-id.service';
import { projectLoan } from '@services/loans/project-loan';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  const loanDetails = await getLoanById({ userId: user.id, accountId: params.id });
  const projection = await projectLoan({
    loanDetails,
    account: loanDetails.account,
    today: new Date(),
  });
  const paymentsCount = await countLoanPayments({ userId: user.id, accountId: params.id });

  return { data: serializeLoan({ loanDetails, projection, paymentsCount }) };
});
