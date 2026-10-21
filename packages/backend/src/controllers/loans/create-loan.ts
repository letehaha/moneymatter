import { createController } from '@controllers/helpers/controller-factory';
import { serializeLoan } from '@root/serializers/loans.serializer';
import { createLoan } from '@services/loans/create-loan.service';
import { projectLoan } from '@services/loans/project-loan';
import { createLoanBodySchema } from '@services/loans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  body: createLoanBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const loanDetails = await createLoan({ userId: user.id, ...body });
  const projection = await projectLoan({
    loanDetails,
    account: loanDetails.account,
    today: new Date(),
  });

  // A just-created loan can't have payments yet.
  return { data: serializeLoan({ loanDetails, projection, paymentsCount: 0 }), statusCode: 201 };
});
