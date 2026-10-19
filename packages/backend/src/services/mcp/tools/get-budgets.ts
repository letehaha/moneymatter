import { BUDGET_STATUSES } from '@bt/shared/types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeBudgets } from '@root/serializers/budgets.serializer';
import { getBudgets } from '@services/budget.service';
import { z } from 'zod';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  status: z
    .enum([BUDGET_STATUSES.active, BUDGET_STATUSES.archived, BUDGET_STATUSES.closed])
    .optional()
    .describe('Filter by tracker status. Default: active'),
};

export function registerGetBudgets(server: McpServer) {
  server.registerTool(
    'get_budgets',
    {
      description:
        'List trackers: spending watchers over a date range, by linked categories or hand-picked transactions, with an optional limit. The app shows them as "Trackers"; tool and field names call them "budget". They are not the period-based Budget plan (lines, assigned amounts, Ready to Assign), which no tool exposes. Filter by status (active, archived, closed). Returns tracker name, limit amount, status, date range, linked categories, and lines: named category sets with their own optional limit (name, limitAmount as decimal, position, categories). A transaction lands in at most one line, the first by position whose categories (expanded to children) contain it; unmatched spending is "other". Per-line spent is in get_budget_spending_stats. Smart tracking fields (owner-only, manual trackers): aiEnabled, aiDescription (what the AI looks for), aiPreWindowDays (days before startDate also scanned), aiLastScannedAt; its suggestions are in list_budget_suggestions.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_budgets', clientId: extra.authInfo?.clientId });
      const statuses: BUDGET_STATUSES[] = args.status ? [args.status] : [BUDGET_STATUSES.active];

      const budgets = await getBudgets({
        userId,
        statuses,
      });

      return jsonContent({ data: serializeBudgets(budgets) });
    },
  );
}
