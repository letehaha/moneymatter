import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getLoanView } from '@services/loans/get-loan-views.service';
import { linkLoanPayments } from '@services/loans/link-loan-payments.service';
import { linkLoanPaymentsBodySchema } from '@services/loans/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentLoan } from './loan-output';

const shape = linkLoanPaymentsBodySchema.shape;

const inputSchema = {
  loanId: recordId().describe('ID of the loan the transactions pay (from get_loans)'),
  transactionIds: shape.transactionIds.describe(
    'IDs of the expense transactions that were payments on the loan, 1 to 500, no duplicates (from search_transactions)',
  ),
  confirmOverpay: shape.confirmOverpay.describe(
    'Default false: payments that would push the loan past what is owed are refused. true accepts it',
  ),
};

export function registerLinkLoanPayments(server: McpServer) {
  server.registerTool(
    'link_loan_payments',
    {
      description:
        'Record existing expense transactions as payments on a loan. Each becomes a transfer to the loan account, which lowers the outstanding balance; unlink_loan_payment undoes one. Payments that would pay off more than is owed are refused unless confirmOverpay is true. Returns { loan, linkedCount }. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'link_loan_payments', clientId: extra.authInfo?.clientId });

      const { linkedCount } = await linkLoanPayments({
        userId,
        accountId: args.loanId,
        transactionIds: args.transactionIds,
        confirmOverpay: args.confirmOverpay,
      });

      const loan = await getLoanView({ userId, accountId: args.loanId });
      return jsonContent({ data: { loan: presentLoan({ loan }), linkedCount } });
    },
  );
}
