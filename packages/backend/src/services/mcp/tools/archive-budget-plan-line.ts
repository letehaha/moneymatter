import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { archiveLine } from '@services/budget-plans/archive-line';
import { restoreLine } from '@services/budget-plans/restore-line';
import { z } from 'zod';

import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeatureAccess, requireScope } from './helpers';

const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  lineId: recordId().describe('Line ID (from get_budget_plan_period)'),
  archived: z
    .boolean()
    .describe(
      'true: archive the line from the current period on. false: restore an archived line into the current period',
    ),
};

export function registerArchiveBudgetPlanLine(server: McpServer) {
  server.registerTool(
    'archive_budget_plan_line',
    {
      description:
        'Archive a line of a budget plan (archived: true) or bring an archived one back (archived: false). Archiving ends the line at the start of the current period: its past periods stay, the amounts assigned to later periods are removed, and its categories become free for another line. Restoring resumes it from the current period with the categories it held when archived; it fails if another line has taken any of them. Archiving returns { archived: true, id, planId }; restoring returns the line { id, name, sortOrder, groupId, activeFrom, activeUntil, categoryIds }. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      requireFeatureAccess({ extra, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'archive_budget_plan_line', clientId: extra.authInfo?.clientId });

      const { planId, lineId, archived } = args;
      if (archived) {
        await archiveLine({ userId, planId, lineId });

        return jsonContent({ data: { archived: true, id: lineId, planId } });
      }

      const line = await restoreLine({ userId, planId, lineId });

      return jsonContent({ data: line });
    },
  );
}
