import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteLoan } from '@services/loans/delete-loan.service';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  loanId: recordId().describe('ID of the loan to delete (from get_loans)'),
};

export function registerDeleteLoan(server: McpServer) {
  server.registerTool(
    'delete_loan',
    {
      description:
        'Permanently delete a loan and its account. A loan with recorded payments is refused (get_loans shows paymentsCount): unlink the payments first with unlink_loan_payment. This action is irreversible: confirm with the user before calling. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_loan', clientId: extra.authInfo?.clientId });

      await deleteLoan({ userId, accountId: args.loanId });

      return jsonContent({ data: { deleted: true, id: args.loanId } });
    },
  );
}
