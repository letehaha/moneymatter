import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { lineGoalSchema } from '@services/budget-plans/line-goal-schema';
import { setLineGoal } from '@services/budget-plans/line-goals';

import {
  assertBaseCurrencyUnlocked,
  getUserId,
  jsonContent,
  requireFeature,
  requireScope,
  type ToolArgs,
} from './helpers';

const goalFields = lineGoalSchema.shape;

// A plain shape cannot carry the schema's refinement, so the handler parses the goal body with the
// full `lineGoalSchema` before calling the service.
const inputSchema = {
  planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
  lineId: recordId().describe('Line ID (from get_budget_plan_period)'),
  frequency: goalFields.frequency.describe(
    'How often the goal asks for money: every_period, weekly (needs weekday), biweekly (needs anchorDate), yearly (needs anchorDate), by_date (needs anchorDate, the due date) or open_ended',
  ),
  behavior: goalFields.behavior.describe(
    'budget_another: assign amount each time. refill_up_to: top the line up to amount. reach_balance: reach a balance of amount. every_period, weekly, biweekly and yearly allow budget_another and refill_up_to; by_date allows all three; open_ended allows only reach_balance',
  ),
  amount: goalFields.amount.describe(
    'Goal amount in the plan currency, greater than 0, with no more decimal places than the plan currency has',
  ),
  weekday: goalFields.weekday.describe(
    'Day of the week, 0 (Sunday) to 6 (Saturday). Required for weekly, refused otherwise',
  ),
  anchorDate: goalFields.anchorDate.describe(
    'YYYY-MM-DD. Required for biweekly, yearly and by_date, refused for the other frequencies. A by_date due date must be in the future unless the goal repeats',
  ),
  repeatEvery: goalFields.repeatEvery.describe(
    'Repeat the by_date goal every N units: 1 to 11 months or 1 to 5 years. Only a by_date budget_another or refill_up_to goal repeats; send it together with repeatUnit',
  ),
  repeatUnit: goalFields.repeatUnit.describe('months or years, together with repeatEvery'),
  stopAtBalance: goalFields.stopAtBalance.describe(
    'budget_another only: stop asking once the line balance reaches this amount, greater than 0',
  ),
  fundingCap: goalFields.fundingCap.describe('refill_up_to only: the most that is asked in one period, greater than 0'),
  periodId: goalFields.periodId.describe(
    'Period the goal starts in (from get_budget_plan_period). A new goal starts in the current period by default; an existing goal keeps its start',
  ),
};

export function validateSetBudgetPlanLineGoalArgs({ args }: { args: ToolArgs<typeof inputSchema> }) {
  const { planId, lineId, ...goal } = args;
  return { planId, lineId, ...lineGoalSchema.parse(goal) };
}

export function registerSetBudgetPlanLineGoal(server: McpServer) {
  server.registerTool(
    'set_budget_plan_line_goal',
    {
      description:
        'Set the goal of a budget plan line: how much it should hold or receive and when. A line has one goal; calling this again replaces it entirely, so send every field you want kept. To remove it use delete_budget_plan_line_goal. Required: planId, lineId, frequency, behavior, amount. The combination is validated: weekly needs weekday (0 to 6) and no other frequency takes one; biweekly, yearly and by_date need anchorDate and the others refuse it; open_ended takes reach_balance only and reach_balance is not allowed for every_period, weekly, biweekly or yearly; repeatEvery with repeatUnit is for by_date budget_another or refill_up_to only; stopAtBalance is for budget_another, fundingCap for refill_up_to. A refused combination returns an error naming the field. Returns the goal { frequency, behavior, amount, weekday, anchorDate, repeatEvery, repeatUnit, stopAtBalance, fundingCap }. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      await requireFeature({ userId, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'set_budget_plan_line_goal', clientId: extra.authInfo?.clientId });

      const data = await setLineGoal({ userId, ...validateSetBudgetPlanLineGoalArgs({ args }) });

      return jsonContent({ data });
    },
  );
}
