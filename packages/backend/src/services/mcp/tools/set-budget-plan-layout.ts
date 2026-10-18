import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { setLayout } from '@services/budget-plans/line-groups';
import { setLayoutBodyFields, setLayoutBodySchema } from '@services/budget-plans/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeatureAccess, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  groups: setLayoutBodyFields.groups.describe(
    'Every group of the plan, once, in display order. Each is { id, lineIds }: the lines in it, in display order',
  ),
  ungroupedLineIds: setLayoutBodyFields.ungroupedLineIds.describe('Lines that sit in no group, in display order'),
};

export function registerSetBudgetPlanLayout(server: McpServer) {
  server.registerTool(
    'set_budget_plan_layout',
    {
      description:
        'Reorder the groups of a budget plan and move lines between groups in one call. groups must list every group of the plan once (ids from get_budget_plan_period, in its groups), in the order to show them, each with its lineIds in order; ungroupedLineIds lists the lines outside any group. A line may appear at most once overall; lines left out keep their placement. Anything else is refused and nothing changes. Returns { updated: true, planId }. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      requireFeatureAccess({ extra, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'set_budget_plan_layout', clientId: extra.authInfo?.clientId });

      const { planId, ...layout } = args;
      await setLayout({ userId, planId, ...setLayoutBodySchema.parse(layout) });

      return jsonContent({ data: { updated: true, planId } });
    },
  );
}
