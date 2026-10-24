import { createController } from '@controllers/helpers/controller-factory';
import { createLoan } from '@services/loans/create-loan.service';
import { toLoanView } from '@services/loans/get-loan-views.service';
import { createLoanBodySchema } from '@services/loans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  body: createLoanBodySchema,
});

export default createController(schema, async ({ user, body }) => {
  const loanDetails = await createLoan({ userId: user.id, ...body });

  // A just-created loan can't have payments yet.
  return { data: await toLoanView({ userId: user.id, loanDetails, paymentsCount: 0 }), statusCode: 201 };
});
