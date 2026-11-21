import { recordId } from '@common/lib/zod/custom-types';
import { getLoanView, getLoanViews } from '@services/loans/get-loan-views.service';

import { defineTool } from '../define-tool';
import { presentLoan } from './loan-output';

export const getLoansTool = defineTool({
  name: 'get_loans',
  toolset: 'loans-vehicles',
  access: 'read',
  description:
    'List the loans (mortgage, auto, student, personal), or read one with loanId. Each loan has the balance (currentBalance is negative while debt is outstanding), the terms (original principal, interest rate, term, planned and minimum payment, payment day, lender) and a projection: paid so far, monthly interest, payoff date, months and interest remaining, and a warning when the planned payment is missing or does not cover the interest. paymentsCount is the number of payments linked to the loan; a loan with payments cannot be deleted. The single-loan read also carries the timeline of events (rate, term and payment changes, balance corrections, notes). All amounts are decimals in the loan currency except the ref* fields, which are in the base currency.',
  input: {
    loanId: recordId()
      .optional()
      .describe(
        'Loan ID (the id of a loan in the list). Omit to list every loan; pass it to read one loan with its timeline',
      ),
  },
  run: async ({ userId, args }) => {
    if (args.loanId) {
      const loan = await getLoanView({ userId, accountId: args.loanId });
      return presentLoan({ loan });
    }

    const loans = await getLoanViews({ userId });
    return loans.map((loan) => presentLoan({ loan, includeEvents: false }));
  },
});
