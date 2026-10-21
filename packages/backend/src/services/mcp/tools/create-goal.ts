import { FEATURES } from '@bt/shared/types';
import { goalFieldsShape } from '@controllers/goals/goal-fields.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGoal } from '@services/goals/create-goal';

import { getUserId, goalsForMcp, jsonContent, requireFeature, requireScope } from './helpers';

const inputSchema = {
  name: goalFieldsShape.name.describe('Goal name'),
  currencyCode: goalFieldsShape.currencyCode.describe(
    "ISO 4217 code of the target currency, e.g. USD. Usually the user's base currency",
  ),
  targetAmount: goalFieldsShape.targetAmount.describe('Target as a decimal amount in currencyCode (e.g. 5000.00)'),
  targetDate: goalFieldsShape.targetDate.describe('Optional deadline (yyyy-MM-dd)'),
  plannedMonthly: goalFieldsShape.plannedMonthly.describe(
    'Optional planned saving per month, decimal in currencyCode. When set it is used as the pace instead of the history',
  ),
  accounts: goalFieldsShape.accounts.describe(
    'Accounts backing the goal, at least one: { accountId, sharePercent } where sharePercent (0 < x <= 100) is the part of the balance that counts. Owned general, cash, current, saving, investment or crypto accounts only. One account can back several goals, but its shares across non-archived goals cannot exceed 100%',
  ),
};

export function registerCreateGoal(server: McpServer) {
  server.registerTool(
    'create_goal',
    {
      description:
        'Create a savings goal: a target amount (optionally by a date) funded by shares of one or more accounts. Fails when the goal currency has no exchange rate or an account would pass 100% shared across non-archived goals (the error names the account and its free %). Needs the Goals feature on the plan or an active trial. Returns the goal in the get_goals shape.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await requireFeature({ userId, feature: FEATURES.goals });
      trackMcpToolUsed({ userId, tool: 'create_goal', clientId: extra.authInfo?.clientId });

      const goal = await createGoal({ userId, ...args });
      const [data] = await goalsForMcp({ userId, goals: [goal] });

      return jsonContent({ data });
    },
  );
}
