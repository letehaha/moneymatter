import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listGoals } from '@services/goals/get-goals';

import { getUserId, goalsForMcp, jsonContent } from './helpers';

export function registerGetGoals(server: McpServer) {
  server.registerTool(
    'get_goals',
    {
      description:
        "List savings goals (active, paused, archived) in the user's order. Each goal has a target amount in its own currency (currencyCode), an optional targetDate and plannedMonthly, and the accounts backing it: sharePercent is the part of that account's balance (minus its credit limit, never below 0) that counts toward the goal. progress holds currentValue, remaining, pace (plannedMonthly when set, else the median monthly change over recent full months), historicalPace, neededMonthly to hit targetDate, etaMonths and daysLeft, all amounts in the goal currency; progress.status is one of no_accounts, reached, overdue, no_date, insufficient_history, ahead, on_track, behind, paused, archived; it stays reached while achievedAt is set. progress is null when the goal currency has no exchange rate today. achievedAt/achievedAmount are set when the goal last reached its target; cleared when the target or currency changes, or after 30 days below target. Not the envelope line goals of the Budget plan.",
    },
    async (extra) => {
      const userId = getUserId({ extra });
      trackMcpToolUsed({ userId, tool: 'get_goals', clientId: extra.authInfo?.clientId });

      const goals = await listGoals({ userId });

      return jsonContent({ data: await goalsForMcp({ userId, goals }) });
    },
  );
}
