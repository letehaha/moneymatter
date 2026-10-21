import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { restorePlan } from '@services/budget-plans/restore-plan';
import { restorePlanBodyFields, restorePlanBodySchema } from '@services/budget-plans/zod-schemas';

import { presentBudgetPlanDetails } from './budget-plan-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('ID of a plan in the trash (from list_budget_plans with includeDeleted)'),
  replace: restorePlanBodyFields.replace.describe(
    'true: if another plan is active, move it to the trash and restore this one in its place. Default false: restoring fails while another plan is active',
  ),
};

export function registerRestoreBudgetPlan(server: McpServer) {
  server.registerTool(
    'restore_budget_plan',
    {
      description:
        'Bring a budget plan back from the trash. Only one plan can be active: while another one is, the restore fails unless replace is true, which moves the active plan to the trash. A plan made in another base currency than the current one cannot be restored. Returns the plan with its accountIds and lines. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await requireFeature({ userId, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'restore_budget_plan', clientId: extra.authInfo?.clientId });

      const body = restorePlanBodySchema.parse({ replace: args.replace });
      const details = await restorePlan({ userId, planId: args.planId, replace: body?.replace });

      return jsonContent({ data: presentBudgetPlanDetails({ details }) });
    },
  );
}
