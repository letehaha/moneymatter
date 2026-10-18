import { createController } from '@controllers/helpers/controller-factory';
import { getLoanView } from '@services/loans/get-loan-views.service';
import { linkLoanPayments } from '@services/loans/link-loan-payments.service';
import { linkLoanPaymentsBodySchema, loanIdParamsSchema } from '@services/loans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: loanIdParamsSchema,
  body: linkLoanPaymentsBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const { linkedCount } = await linkLoanPayments({
    userId: user.id,
    accountId: params.id,
    transactionIds: body.transactionIds,
    confirmOverpay: body.confirmOverpay,
  });

  return { data: { loan: await getLoanView({ userId: user.id, accountId: params.id }), linkedCount } };
});
