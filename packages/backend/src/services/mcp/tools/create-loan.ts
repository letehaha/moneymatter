import { createLoan } from '@services/loans/create-loan.service';
import { toLoanView } from '@services/loans/get-loan-views.service';
import { createLoanBodyFields, createLoanBodySchema } from '@services/loans/zod-schemas';

import { defineTool } from '../define-tool';
import { presentLoan } from './loan-output';

export const createLoanTool = defineTool({
  name: 'create_loan',
  toolset: 'loans-vehicles',
  access: 'write',
  description:
    'Create a loan: a liability account with the loan terms. initialBalance is what is still owed today and originalPrincipal what was lent, both as positive decimals in the loan currency. loanType is mortgage, auto, student or personal. Optional: termMonths, minPayment, plannedPayment, paymentDayOfMonth (1-31), lenderName, accountNumber. Returns the loan with its payoff projection.',
  input: {
    ...createLoanBodyFields,
    name: createLoanBodyFields.name.describe('Loan name'),
    currencyCode: createLoanBodyFields.currencyCode.describe('ISO currency code of the loan (e.g. "USD")'),
    initialBalance: createLoanBodyFields.initialBalance.describe(
      'Amount still owed today, as a positive decimal in the loan currency (not negative: the loan balance itself is stored as debt)',
    ),
    originalPrincipal: createLoanBodyFields.originalPrincipal.describe(
      'Amount the lender originally lent, as a positive decimal. It stays fixed and is the base of the payoff projection',
    ),
    interestRate: createLoanBodyFields.interestRate.describe('Annual interest rate in percent, e.g. 6.5'),
    startDate: createLoanBodyFields.startDate.describe('Date the loan started, YYYY-MM-DD, not in the future'),
    minPayment: createLoanBodyFields.minPayment.describe('Minimum monthly payment, a decimal'),
    plannedPayment: createLoanBodyFields.plannedPayment.describe(
      'Monthly payment the user plans to make, a decimal. Without it there is no payoff date in the projection',
    ),
  },
  validate: ({ args }) => createLoanBodySchema.parse(args),
  run: async ({ userId, args }) => {
    const loanDetails = await createLoan({ userId, ...args });

    // A just-created loan can't have payments yet.
    const loan = await toLoanView({ userId, loanDetails, paymentsCount: 0 });
    return presentLoan({ loan });
  },
});
