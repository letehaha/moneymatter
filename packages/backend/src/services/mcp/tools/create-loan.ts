import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createLoan } from '@services/loans/create-loan.service';
import { toLoanView } from '@services/loans/get-loan-views.service';
import { createLoanBodyFields, createLoanBodySchema } from '@services/loans/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope, type ToolArgs } from './helpers';
import { presentLoan } from './loan-output';

const inputSchema = {
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
};

export function validateCreateLoanArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  return createLoanBodySchema.parse(args);
}

export function registerCreateLoan(server: McpServer) {
  server.registerTool(
    'create_loan',
    {
      description:
        'Create a loan: a liability account with the loan terms. initialBalance is what is still owed today and originalPrincipal what was lent, both as positive decimals in the loan currency. loanType is mortgage, auto, student or personal. Optional: termMonths, minPayment, plannedPayment, paymentDayOfMonth (1-31), lenderName, accountNumber. Returns the loan with its payoff projection. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_loan', clientId: extra.authInfo?.clientId });

      const loanDetails = await createLoan({ userId, ...validateCreateLoanArgs({ args }) });

      // A just-created loan can't have payments yet.
      const loan = await toLoanView({ userId, loanDetails, paymentsCount: 0 });
      return jsonContent({ data: presentLoan({ loan }) });
    },
  );
}
