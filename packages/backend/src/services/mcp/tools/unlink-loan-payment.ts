import { recordId } from '@common/lib/zod/custom-types';
import { getLoanView } from '@services/loans/get-loan-views.service';
import { unlinkLoanPayment } from '@services/loans/unlink-loan-payment.service';
import { unlinkLoanPaymentBodySchema } from '@services/loans/zod-schemas';

import { defineTool } from '../define-tool';
import { presentLoan } from './loan-output';

export const unlinkLoanPaymentTool = defineTool({
  name: 'unlink_loan_payment',
  toolset: 'loans-vehicles',
  access: 'write',
  description:
    'Undo a loan payment: the loan-side leg is deleted, the source transaction is restored to a plain expense and the outstanding balance goes back up. Pass either leg of the payment. Returns { loan, restoredTransactionId }.',
  input: {
    loanId: recordId().describe('ID of the loan (from get_loans)'),
    transactionId: unlinkLoanPaymentBodySchema.shape.transactionId.describe(
      'ID of either leg of the payment: the loan-side income or the source expense (from search_transactions)',
    ),
  },
  run: async ({ userId, args }) => {
    const { restoredTransactionId } = await unlinkLoanPayment({
      userId,
      accountId: args.loanId,
      transactionId: args.transactionId,
    });

    const loan = await getLoanView({ userId, accountId: args.loanId });
    return { loan: presentLoan({ loan }), restoredTransactionId };
  },
});
