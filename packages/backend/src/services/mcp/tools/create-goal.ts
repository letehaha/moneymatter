import { FEATURES } from '@bt/shared/types';
import { goalFieldsShape } from '@controllers/goals/goal-fields.schema';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGoal } from '@services/goals/create-goal';

import {
  assertBaseCurrencyUnlocked,
  getUserId,
  goalsForMcp,
  jsonContent,
  requireFeature,
  requireScope,
} from './helpers';

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
    "Accounts backing the goal, at least one. Each is either { accountId, sharePercent } or { accountId, fixedAmount, fixedPosition? }. A fixedAmount (decimal in the account's currency) is taken from the balance first; when the balance can't cover every goal's fixed amount on the account, they are filled in fixedPosition order (0 first; omit it to keep the current place or append). sharePercent (0 < x <= 100) is the part of what is left after fixed amounts. Owned general, cash, current, saving, investment or crypto accounts only. An account's sharePercent values across non-archived goals cannot exceed 100%. When every account is a fixedAmount, their sum must reach targetAmount",
  ),
  reachedHoldDays: goalFieldsShape.reachedHoldDays.describe(
    'Days (0-365, default 30) after first reaching the target during which a dip below it still counts as reached. 0 follows the balance live',
  ),
};

export function registerCreateGoal(server: McpServer) {
  server.registerTool(
    'create_goal',
    {
      description:
        'Create a savings goal: a target amount (optionally by a date) funded by percent shares or fixed amounts of one or more accounts. Fails when the goal currency has no exchange rate, an account would pass 100% shared across non-archived goals (the error names the account and its free %), or fixed amounts alone fall short of the target. Needs the Goals feature on the plan or an active trial. Returns the goal in the get_goals shape.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await requireFeature({ userId, feature: FEATURES.goals });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_goal', clientId: extra.authInfo?.clientId });

      const goal = await createGoal({ userId, ...args });
      const [data] = await goalsForMcp({ userId, goals: [goal] });

      return jsonContent({ data });
    },
  );
}
