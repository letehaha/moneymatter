import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { snoozeLineGoal } from '@services/budget-plans/line-goals';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeatureAccess, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  lineId: recordId().describe('Line ID (from get_budget_plan_period)'),
  periodId: recordId().describe('Period to snooze the goal for (from get_budget_plan_period)'),
};

export function registerSnoozeBudgetPlanLineGoal(server: McpServer) {
  server.registerTool(
    'snooze_budget_plan_line_goal',
    {
      description:
        'Snooze the goal of a budget plan line for one period, so it asks for nothing from that period. Calling it again for the period the goal is already snoozed for wakes the goal up again (a toggle). An open_ended goal cannot be snoozed, and a line with no goal returns an error. Returns the goal { frequency, behavior, amount, weekday, anchorDate, repeatEvery, repeatUnit, stopAtBalance, fundingCap }. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      requireFeatureAccess({ extra, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'snooze_budget_plan_line_goal', clientId: extra.authInfo?.clientId });

      const data = await snoozeLineGoal({ userId, planId: args.planId, lineId: args.lineId, periodId: args.periodId });

      return jsonContent({ data });
    },
  );
}
