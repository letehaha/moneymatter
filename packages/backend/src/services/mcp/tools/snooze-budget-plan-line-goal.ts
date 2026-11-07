import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { snoozeLineGoal } from '@services/budget-plans/line-goals';

import { defineTool } from '../define-tool';

export const snoozeBudgetPlanLineGoalTool = defineTool({
  name: 'snooze_budget_plan_line_goal',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    'Snooze the goal of a budget plan line for one period, so it asks for nothing from that period. Calling it again for the period the goal is already snoozed for wakes the goal up again (a toggle). An open_ended goal cannot be snoozed, and a line with no goal returns an error. Returns the goal { frequency, behavior, amount, weekday, anchorDate, repeatEvery, repeatUnit, stopAtBalance, fundingCap }. Needs a plan that includes budget plans.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    lineId: recordId().describe('Line ID (from get_budget_plan_period)'),
    periodId: recordId().describe('Period to snooze the goal for (from get_budget_plan_period)'),
  },
  run: ({ userId, args }) =>
    snoozeLineGoal({ userId, planId: args.planId, lineId: args.lineId, periodId: args.periodId }),
});
