import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addTransactionsToBudget } from '@services/budgets/add-transactions-to-budget';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the tracker to link transactions to'),
  transactionIds: z.array(recordId()).describe('IDs of the transactions to add to the tracker'),
};

export function registerAddTransactionsToBudget(server: McpServer) {
  server.registerTool(
    'add_transactions_to_budget',
    {
      description:
        'Manually link one or more transactions to a manual-type tracker (a "budget" in tool and field names). Category-type trackers do not support manual linking. Returns a success message on completion.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'add_transactions_to_budget', clientId: extra.authInfo?.clientId });

      const result = await addTransactionsToBudget({
        budgetId: args.budgetId,
        userId,
        transactionIds: args.transactionIds,
      });

      return jsonContent({ data: result });
    },
  );
}
