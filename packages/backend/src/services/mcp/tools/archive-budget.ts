import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { toggleBudgetArchive } from '@services/budgets/toggle-archive';
import { z } from 'zod';

import { getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the tracker to archive or unarchive'),
  isArchived: z.boolean().describe('true to archive the tracker, false to restore it to active'),
};

export function registerArchiveBudget(server: McpServer) {
  server.registerTool(
    'archive_budget',
    {
      description:
        'Archive or unarchive a tracker (a "budget" in tool and field names). Pass isArchived: true to archive (sets status to "archived"), false to restore it to active. Returns the updated tracker.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      trackMcpToolUsed({ userId, tool: 'archive_budget', clientId: extra.authInfo?.clientId });

      const budget = await toggleBudgetArchive({ id: args.budgetId, userId, isArchived: args.isArchived });

      return jsonContent({ data: budget });
    },
  );
}
