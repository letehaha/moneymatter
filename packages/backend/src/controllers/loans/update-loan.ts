import { createController } from '@controllers/helpers/controller-factory';
import { serializeLoan } from '@root/serializers/loans.serializer';
import { countLoanPayments } from '@services/loans/count-loan-payments.service';
import { projectLoan } from '@services/loans/project-loan';
import { updateLoan } from '@services/loans/update-loan.service';
import { loanIdParamsSchema, updateLoanBodySchema } from '@services/loans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: loanIdParamsSchema,
  body: updateLoanBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const loanDetails = await updateLoan({ userId: user.id, accountId: params.id, ...body });
  const projection = await projectLoan({
    loanDetails,
    account: loanDetails.account,
    today: new Date(),
  });
  const paymentsCount = await countLoanPayments({ userId: user.id, accountId: params.id });

  return { data: serializeLoan({ loanDetails, projection, paymentsCount }) };
});
