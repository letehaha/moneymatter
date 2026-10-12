import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { removeTransactionsFromBudget } from '@services/budgets/remove-transactions-from-budget';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the tracker to unlink transactions from'),
  transactionIds: z.array(recordId()).describe('IDs of the transactions to remove from the tracker'),
};

export function registerRemoveTransactionsFromBudget(server: McpServer) {
  server.registerTool(
    'remove_transactions_from_budget',
    {
      description:
        'Unlink one or more transactions from a tracker (a "budget" in tool and field names). Does not delete the transactions themselves. Returns nothing on success.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'remove_transactions_from_budget', clientId: extra.authInfo?.clientId });

      await removeTransactionsFromBudget({
        budgetId: args.budgetId,
        userId,
        transactionIds: args.transactionIds,
      });

      return jsonContent({ data: { success: true } });
    },
  );
}
