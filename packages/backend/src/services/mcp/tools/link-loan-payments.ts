import { recordId } from '@common/lib/zod/custom-types';
import { getLoanView } from '@services/loans/get-loan-views.service';
import { linkLoanPayments } from '@services/loans/link-loan-payments.service';
import { linkLoanPaymentsBodySchema } from '@services/loans/zod-schemas';

import { defineTool } from '../define-tool';
import { presentLoan } from './loan-output';

const shape = linkLoanPaymentsBodySchema.shape;

export const linkLoanPaymentsTool = defineTool({
  name: 'link_loan_payments',
  toolset: 'loans-vehicles',
  access: 'write',
  description:
    'Record existing expense transactions as payments on a loan. Each becomes a transfer to the loan account, which lowers the outstanding balance; unlink_loan_payment undoes one. Payments that would pay off more than is owed are refused unless confirmOverpay is true. Returns { loan, linkedCount }.',
  input: {
    loanId: recordId().describe('ID of the loan the transactions pay (from get_loans)'),
    transactionIds: shape.transactionIds.describe(
      'IDs of the expense transactions that were payments on the loan, 1 to 500, no duplicates (from search_transactions)',
    ),
    confirmOverpay: shape.confirmOverpay.describe(
      'Default false: payments that would push the loan past what is owed are refused. true accepts it',
    ),
  },
  run: async ({ userId, args }) => {
    const { linkedCount } = await linkLoanPayments({
      userId,
      accountId: args.loanId,
      transactionIds: args.transactionIds,
      confirmOverpay: args.confirmOverpay,
    });

    const loan = await getLoanView({ userId, accountId: args.loanId });
    return { loan: presentLoan({ loan }), linkedCount };
  },
});
