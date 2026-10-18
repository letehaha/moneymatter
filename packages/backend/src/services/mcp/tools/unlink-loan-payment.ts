import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getLoanView } from '@services/loans/get-loan-views.service';
import { unlinkLoanPayment } from '@services/loans/unlink-loan-payment.service';
import { unlinkLoanPaymentBodySchema } from '@services/loans/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';
import { presentLoan } from './loan-output';

const inputSchema = {
  loanId: recordId().describe('ID of the loan (from get_loans)'),
  transactionId: unlinkLoanPaymentBodySchema.shape.transactionId.describe(
    'ID of either leg of the payment: the loan-side income or the source expense (from search_transactions)',
  ),
};

export function registerUnlinkLoanPayment(server: McpServer) {
  server.registerTool(
    'unlink_loan_payment',
    {
      description:
        'Undo a loan payment: the loan-side leg is deleted, the source transaction is restored to a plain expense and the outstanding balance goes back up. Pass either leg of the payment. Returns { loan, restoredTransactionId }. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'unlink_loan_payment', clientId: extra.authInfo?.clientId });

      const { restoredTransactionId } = await unlinkLoanPayment({
        userId,
        accountId: args.loanId,
        transactionId: args.transactionId,
      });

      const loan = await getLoanView({ userId, accountId: args.loanId });
      return jsonContent({ data: { loan: presentLoan({ loan }), restoredTransactionId } });
    },
  );
}
