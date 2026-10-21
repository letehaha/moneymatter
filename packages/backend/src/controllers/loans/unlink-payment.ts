import { createController } from '@controllers/helpers/controller-factory';
import { serializeLoan } from '@root/serializers/loans.serializer';
import { countLoanPayments } from '@services/loans/count-loan-payments.service';
import { getLoanById } from '@services/loans/get-loan-by-id.service';
import { projectLoan } from '@services/loans/project-loan';
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

  const loanDetails = await getLoanById({ userId: user.id, accountId: params.id });
  const projection = await projectLoan({
    loanDetails,
    account: loanDetails.account,
    today: new Date(),
  });
  const paymentsCount = await countLoanPayments({ userId: user.id, accountId: params.id });

  return {
    data: { loan: serializeLoan({ loanDetails, projection, paymentsCount }), restoredTransactionId },
  };
});
