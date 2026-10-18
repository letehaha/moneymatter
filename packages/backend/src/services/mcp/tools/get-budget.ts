import { recordId } from '@common/lib/zod/custom-types';
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serializeBudget, serializeBudgetStats } from '@root/serializers';
import { getBudgetById } from '@services/budget.service';
import { getBudgetStats } from '@services/budgets/stats';

import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  budgetId: recordId().describe('ID of the tracker to read (from get_budgets)'),
};

export function registerGetBudget(server: McpServer) {
  server.registerTool(
    'get_budget',
    {
      description:
        'Get one tracker (a "budget" in tool and field names) with its progress: the tracker itself (name, status, type, date range, limit, linked categories, and the share details when it is shared with the user) and its stats (income, expense and balance over the tracker period, how much of the limit is used, how many transactions it covers, and the first and last transaction date). Amounts are decimals in the base currency of the tracker owner. For the spending split by category and the time-series use get_budget_spending_stats; for the transactions of a category tracker use get_budget_transactions.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_budget', clientId: extra.authInfo?.clientId });

      const budget = await findOrThrowNotFound({
        query: getBudgetById({ id: args.budgetId, userId }),
        message: t({ key: 'budgets.budgetNotFound' }),
      });
      const { stats, decimals } = await getBudgetStats({ userId, budgetId: args.budgetId });

      return jsonContent({
        data: { budget: serializeBudget(budget), stats: serializeBudgetStats({ stats, decimals }) },
      });
    },
  );
}
