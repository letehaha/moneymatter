import { recordId } from '@common/lib/zod/custom-types';
import { toLoanView } from '@services/loans/get-loan-views.service';
import { updateLoan } from '@services/loans/update-loan.service';
import { updateLoanBodyFields, updateLoanBodySchema } from '@services/loans/zod-schemas';

import { defineTool } from '../define-tool';
import { presentLoan } from './loan-output';

export const updateLoanTool = defineTool({
  name: 'update_loan',
  toolset: 'loans-vehicles',
  access: 'write',
  description:
    'Update a loan. Only the fields you send change; at least one is required. Editable: name, currentBalance (the amount still owed, positive) with currentBalanceAsOf, interestRate, termMonths, startDate, minPayment, plannedPayment, paymentDayOfMonth, lenderName, accountNumber. Send null to clear termMonths, minPayment, plannedPayment, paymentDayOfMonth, lenderName or accountNumber. The currency, type and original principal cannot be changed. Returns the loan with its projection.',
  input: {
    loanId: recordId().describe('ID of the loan to update (from get_loans)'),
    ...updateLoanBodyFields,
    currentBalance: updateLoanBodyFields.currentBalance.describe(
      'Correct the amount still owed, as a positive decimal in the loan currency. Recorded as a balance correction in the timeline',
    ),
    currentBalanceAsOf: updateLoanBodyFields.currentBalanceAsOf.describe(
      'Date (YYYY-MM-DD, not in the future) the currentBalance was true on; payments dated on or after it count on top. Requires currentBalance',
    ),
    interestRate: updateLoanBodyFields.interestRate.describe(
      'Annual interest rate in percent. A change is added to the timeline',
    ),
    termMonths: updateLoanBodyFields.termMonths.describe('Term in months; null clears it'),
    minPayment: updateLoanBodyFields.minPayment.describe('Minimum monthly payment; null clears it'),
    plannedPayment: updateLoanBodyFields.plannedPayment.describe(
      'Planned monthly payment; null clears it. A change is added to the timeline',
    ),
  },
  validate: ({ args }) => {
    const { loanId, ...body } = args;
    return { loanId, ...updateLoanBodySchema.parse(body) };
  },
  run: async ({ userId, args: { loanId, ...body } }) => {
    const loanDetails = await updateLoan({ userId, accountId: loanId, ...body });

    const loan = await toLoanView({ userId, loanDetails });
    return presentLoan({ loan });
  },
});
