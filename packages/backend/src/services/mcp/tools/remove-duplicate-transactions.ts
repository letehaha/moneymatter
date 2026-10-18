import { reconciliationIdsBodySchema } from '@controllers/transactions.controller/reconciliation-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeTransactions } from '@services/transactions/reconciliation/remove-transactions';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transactionIds: reconciliationIdsBodySchema.shape.transactionIds.describe(
    'IDs of the transactions to remove (1 to 500, no repeats)',
  ),
};

export function registerRemoveDuplicateTransactions(server: McpServer) {
  server.registerTool(
    'remove_duplicate_transactions',
    {
      description:
        'Remove duplicate transactions from the books: they disappear from lists, budgets and reports, and the account balance is left as it is. The rows are soft-deleted, so restore_removed_transactions brings them back, but a restored row does not get back the budget, group or subscription links removed with it. Use it for a pending bank row that the booked row replaced (see list_stuck_pending_transactions) or any other duplicate you want to drop and keep the other copy as it is; to keep the links of the dropped rows, merge them with merge_duplicate_transactions instead. Planned rows, transfers, refund-linked rows and system-account rows are refused. Returns { removedIds }. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'remove_duplicate_transactions', clientId: extra.authInfo?.clientId });

      const result = await removeTransactions({ userId, transactionIds: args.transactionIds });
      return jsonContent({ data: result });
    },
  );
}
