import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getPlan, listPlans } from '@services/budget-plans/get-plan';
import { z } from 'zod';

import { presentBudgetPlan, presentBudgetPlanDetails } from './budget-plan-output';
import { getUserId, jsonContent } from './helpers';

const inputSchema = {
  planId: recordId()
    .optional()
    .describe('Budget plan ID (from this tool). Omit to list every plan; pass it to read one plan with its lines'),
  includeDeleted: z
    .boolean()
    .optional()
    .describe('List: also include plans in the trash (they carry a deletedAt date). Ignored when planId is set'),
};

export function registerListBudgetPlans(server: McpServer) {
  server.registerTool(
    'list_budget_plans',
    {
      description:
        'List the budget plans (the "Budget" in the app: period envelopes where money is assigned to lines, not the trackers behind get_budgets), or read one with planId. A plan has a name, type, currencyCode (the base currency when it was created; every plan amount is in it), cadence and intervalN (a period every N days or months, or semi_monthly), anchorDate, epochDate (first budgeted day), carryPolicy, autoAttachAccounts, poolFrom (the first period funded from a pool, null: no pool), zeroSum, and expectedIncome (a decimal or null). Reading one plan also returns accountIds (the accounts it counts) and lines, each with its name, groupId, activeFrom/activeUntil and categoryIds. Use the plan id with list_budget_plan_periods, get_budget_plan_period, get_budget_plan_scheduled and get_budget_plan_trends. All amounts are decimals.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'list_budget_plans', clientId: extra.authInfo?.clientId });

      if (args.planId) {
        const details = await getPlan({ userId, planId: args.planId });
        return jsonContent({ data: presentBudgetPlanDetails({ details }) });
      }

      const plans = await listPlans({ userId, includeDeleted: args.includeDeleted });
      return jsonContent({ data: plans.map((plan) => presentBudgetPlan({ plan })) });
    },
  );
}
