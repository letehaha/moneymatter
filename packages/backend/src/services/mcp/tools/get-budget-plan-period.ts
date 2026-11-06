import { recordId } from '@common/lib/zod/custom-types';
import { getPeriodView } from '@services/budget-plans/get-period-view';

import { defineTool } from '../define-tool';

export const getBudgetPlanPeriodTool = defineTool({
  name: 'get_budget_plan_period',
  toolset: 'budget-plans',
  access: 'read',
  description:
    'Read one period of a budget plan: the figures behind the Budget screen. Returns { period, header, groups, lines, pool, unbudgeted, goals, coverage }. header has totalAssigned, totalActivity (spending is negative), totalCarriedIn and totalAvailable. Each line has what was assigned, its activity and what is available, with its goal progress when it has a goal. pool (null without a pool) has readyToAssign, committedLater, the flow and the balance. unbudgeted lists the category activity no line covers. coverage tells how ready the next period is. All amounts are decimals in the plan currency (list_budget_plans, currencyCode).',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    periodId: recordId().describe('Period ID (from list_budget_plan_periods)'),
  },
  run: ({ userId, args }) => getPeriodView({ userId, planId: args.planId, periodId: args.periodId }),
});
