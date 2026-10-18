import { createController } from '@controllers/helpers/controller-factory';
import { getLoanView } from '@services/loans/get-loan-views.service';
import { unlinkLoanPayment } from '@services/loans/unlink-loan-payment.service';
import { loanIdParamsSchema, unlinkLoanPaymentBodySchema } from '@services/loans/zod-schemas';
import { z } from 'zod';

const schema = z.object({
  params: loanIdParamsSchema,
  body: unlinkLoanPaymentBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const { restoredTransactionId } = await unlinkLoanPayment({
    userId: user.id,
    accountId: params.id,
    transactionId: body.transactionId,
  });

  return { data: { loan: await getLoanView({ userId: user.id, accountId: params.id }), restoredTransactionId } };
});
