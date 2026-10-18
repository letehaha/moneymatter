import { FEATURES } from '@bt/shared/types';
import { budgetSuggestionAnswers, recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { addSuggestedLines } from '@services/budget-plans/suggested-lines';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeatureAccess, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  answers: budgetSuggestionAnswers()
    .optional()
    .describe(
      'Answers that steer the suggested lines. The accepted keys are listed in this schema; focusCategoryIds come from get_budget_plan_suggestion_context',
    ),
};

export function registerAddSuggestedBudgetPlanLines(server: McpServer) {
  server.registerTool(
    'add_suggested_budget_plan_lines',
    {
      description:
        "Draft starter lines (and groups) for a budget plan from the spending history of its accounts, skipping categories another line already covers. It may use the server's AI to arrange the lines; without it the lines come from the spending ranking or a fixed starter set and only answers.detail is honoured (answersIgnored: true in the result). This can take a while. Returns { created, answersIgnored? }; created: 0 means there was nothing to suggest. Needs a plan that includes budget plans. Requires finance:write scope.",
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      requireFeatureAccess({ extra, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'add_suggested_budget_plan_lines', clientId: extra.authInfo?.clientId });

      const result = await addSuggestedLines({ userId, planId: args.planId, answers: args.answers });

      return jsonContent({ data: result });
    },
  );
}
