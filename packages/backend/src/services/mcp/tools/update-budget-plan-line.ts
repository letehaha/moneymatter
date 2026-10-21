import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateLine } from '@services/budget-plans/update-line';
import { updateLineBodyFields, updateLineBodySchema } from '@services/budget-plans/zod-schemas';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  lineId: recordId().describe('Line ID (from get_budget_plan_period or list_budget_plans with planId)'),
  name: updateLineBodyFields.name.describe('New name, 1 to 200 characters'),
  sortOrder: updateLineBodyFields.sortOrder.describe(
    'New position among the lines of its group (an integer). A line moved to another group lands last there unless this says otherwise',
  ),
  groupId: updateLineBodyFields.groupId.describe('Move the line to this group; null ungroups it'),
  categoryIds: updateLineBodyFields.categoryIds.describe(
    'The full new set of categories (from get_categories), at least one; it replaces the current set from effectiveFrom on. A category can belong to one line at a time',
  ),
  effectiveFrom: updateLineBodyFields.effectiveFrom.describe(
    'Period start (YYYY-MM-DD) the new categories apply from, within the line lifetime and up to the current period. Only with categoryIds; default: the current period',
  ),
};

export function registerUpdateBudgetPlanLine(server: McpServer) {
  server.registerTool(
    'update_budget_plan_line',
    {
      description:
        'Change a line of a budget plan. Send only the fields to change: name, sortOrder, groupId (null ungroups), categoryIds, effectiveFrom. effectiveFrom is accepted only together with categoryIds; categoryIds cannot be empty (to retire a line use archive_budget_plan_line). The start and end of the line and its id cannot be changed, and any other field is not accepted. Returns the line { id, name, sortOrder, groupId, activeFrom, activeUntil, categoryIds }. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await requireFeature({ userId, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'update_budget_plan_line', clientId: extra.authInfo?.clientId });

      const { planId, lineId, ...patch } = args;
      const line = await updateLine({ userId, planId, lineId, ...updateLineBodySchema.parse(patch) });

      return jsonContent({ data: line });
    },
  );
}
