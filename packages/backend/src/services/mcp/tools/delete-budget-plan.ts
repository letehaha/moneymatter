import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { deletePlan, purgePlan } from '@services/budget-plans/delete-plan';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  permanent: z
    .boolean()
    .optional()
    .describe(
      'true: erase a plan that is already in the trash for good, with its lines and periods. An active plan is not found this way: delete it without this flag first. Default false: move the plan to the trash',
    ),
};

export function registerDeleteBudgetPlan(server: McpServer) {
  server.registerTool(
    'delete_budget_plan',
    {
      description:
        'Delete a budget plan. By default it moves to the trash, which frees the single active-plan slot and keeps the plan for 30 days: restore_budget_plan brings it back (list_budget_plans with includeDeleted shows trashed plans). With permanent: true it erases a plan that is already in the trash, with all its lines, periods and assignments. That is irreversible: confirm with the user before calling. Not limited by the plan features, because an active plan blocks base-currency changes. Requires finance:delete scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:delete' });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'delete_budget_plan', clientId: extra.authInfo?.clientId });

      const permanent = args.permanent === true;
      await (permanent ? purgePlan : deletePlan)({ userId, planId: args.planId });

      return jsonContent({ data: { deleted: true, id: args.planId, permanent } });
    },
  );
}
