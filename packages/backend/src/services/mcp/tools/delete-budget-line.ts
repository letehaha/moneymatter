import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deleteTrackerLine } from '@services/budgets/lines/delete-line';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the tracker the line belongs to'),
  lineId: recordId().describe('ID of the line to delete'),
};

export function registerDeleteBudgetLine(server: McpServer) {
  server.registerTool(
    'delete_budget_line',
    {
      description:
        'Permanently delete a line from a tracker (a "budget" in tool and field names). Transactions are kept; their spending moves to the next matching line or to "other". Requires manage access to the tracker. Returns { success: true } on completion.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      trackMcpToolUsed({ userId, tool: 'delete_budget_line', clientId: extra.authInfo?.clientId });

      await deleteTrackerLine({
        userId,
        budgetId: args.budgetId,
        lineId: args.lineId,
      });

      return jsonContent({ data: { success: true } });
    },
  );
}
