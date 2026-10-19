import { reconciliationMergeBodySchema } from '@controllers/transactions.controller/reconciliation-schemas';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { mergeTransactions } from '@services/transactions/reconciliation/merge-transactions';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  transactionIds: reconciliationMergeBodySchema.shape.transactionIds.describe(
    'IDs of the duplicate transactions, the survivor included (2 to 4, no repeats, all on the same account)',
  ),
  survivorId: reconciliationMergeBodySchema.shape.survivorId.describe(
    'ID of the transaction to keep; it must be one of transactionIds',
  ),
};

export function registerMergeDuplicateTransactions(server: McpServer) {
  server.registerTool(
    'merge_duplicate_transactions',
    {
      description:
        'Merge duplicate transactions of one account into a survivor: the other rows are removed and their tracker, group and subscription links move to the survivor, which keeps its own data. The removed rows are soft-deleted, so restore_removed_transactions brings them back, but a restored row does not get its links back (they stay on the survivor). Planned rows, transfers, refund-linked rows and system-account rows are refused, as is a merge whose rows link to different budgets, groups or subscriptions than the survivor can take. Returns { removedIds }, the merged rows. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'merge_duplicate_transactions', clientId: extra.authInfo?.clientId });

      const result = await mergeTransactions({
        userId,
        transactionIds: args.transactionIds,
        survivorId: args.survivorId,
      });
      return jsonContent({ data: result });
    },
  );
}
