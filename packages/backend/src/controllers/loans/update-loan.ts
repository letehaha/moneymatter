import { createController } from '@controllers/helpers/controller-factory';
import { toLoanView } from '@services/loans/get-loan-views.service';
import { updateLoan } from '@services/loans/update-loan.service';
import { loanIdParamsSchema, updateLoanBodySchema } from '@services/loans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: loanIdParamsSchema,
  body: updateLoanBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const loanDetails = await updateLoan({ userId: user.id, accountId: params.id, ...body });

  return { data: await toLoanView({ userId: user.id, loanDetails }) };
});
