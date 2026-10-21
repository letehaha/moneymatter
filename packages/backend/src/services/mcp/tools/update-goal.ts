import { FEATURES, GOAL_STATUSES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { goalFieldsShape } from '@controllers/goals/goal-fields.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { updateGoal } from '@services/goals/update-goal';
import { z } from 'zod';

import { getUserId, goalsForMcp, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  goalId: recordId().describe('ID of the goal to update'),
  name: goalFieldsShape.name.optional().describe('New goal name'),
  currencyCode: goalFieldsShape.currencyCode.optional().describe('New target currency (ISO 4217)'),
  targetAmount: goalFieldsShape.targetAmount.optional().describe('New target, decimal in the goal currency'),
  targetDate: goalFieldsShape.targetDate.describe('New deadline (yyyy-MM-dd). Pass null to remove it'),
  plannedMonthly: goalFieldsShape.plannedMonthly.describe(
    'New planned saving per month, decimal in the goal currency. Pass null to fall back to the historical pace',
  ),
  status: z
    .enum(GOAL_STATUSES)
    .optional()
    .describe(
      "active, paused or archived. Archiving frees the accounts' shares; restoring re-checks that every account stays within 100%",
    ),
  accounts: goalFieldsShape.accounts
    .optional()
    .describe(
      "Replaces the whole set of backing accounts: { accountId, sharePercent }. Each account's shares across non-archived goals cannot exceed 100%",
    ),
};

export function registerUpdateGoal(server: McpServer) {
  server.registerTool(
    'update_goal',
    {
      description:
        'Update a savings goal. Only passed fields change; accounts replaces the whole set. Use status to pause, archive or restore a goal. Fails when an account would pass 100% shared across non-archived goals or the new currency has no exchange rate. Needs the Goals feature on the plan or an active trial. Returns the goal in the get_goals shape.',
      inputSchema,
    },
    async ({ goalId, ...fields }, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await requireFeature({ userId, feature: FEATURES.goals });
      trackMcpToolUsed({ userId, tool: 'update_goal', clientId: extra.authInfo?.clientId });

      const goal = await updateGoal({ userId, goalId, ...fields });
      const [data] = await goalsForMcp({ userId, goals: [goal] });

      return jsonContent({ data });
    },
  );
}
