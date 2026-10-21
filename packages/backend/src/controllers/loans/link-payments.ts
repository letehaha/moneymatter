import { createController } from '@controllers/helpers/controller-factory';
import { serializeLoan } from '@root/serializers/loans.serializer';
import { countLoanPayments } from '@services/loans/count-loan-payments.service';
import { getLoanById } from '@services/loans/get-loan-by-id.service';
import { linkLoanPayments } from '@services/loans/link-loan-payments.service';
import { projectLoan } from '@services/loans/project-loan';
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

  const loanDetails = await getLoanById({ userId: user.id, accountId: params.id });
  const projection = await projectLoan({
    loanDetails,
    account: loanDetails.account,
    today: new Date(),
  });
  const paymentsCount = await countLoanPayments({ userId: user.id, accountId: params.id });

  return {
    data: { loan: serializeLoan({ loanDetails, projection, paymentsCount }), linkedCount },
  };
});
