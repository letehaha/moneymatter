import { recordId } from '@common/lib/zod/custom-types';
import { listPeriods } from '@services/budget-plans/list-periods';
import { z } from 'zod';

import { defineTool } from '../define-tool';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 200;

export const listBudgetPlanPeriodsTool = defineTool({
  name: 'list_budget_plan_periods',
  toolset: 'budget-plans',
  access: 'read',
  description:
    'List the periods of a budget plan, newest first. A plan always has its future periods (up to a year ahead), so the first entries are upcoming ones; the one with isCurrent true covers today. Each period has id, startDate, endDate (exclusive) and isCurrent. Returns { periods, total }, total being the number of periods before limit and offset; raise offset to reach older ones. Pass a period id to get_budget_plan_period or get_budget_plan_scheduled.',
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    limit: z
      .number()
      .int()
      .positive()
      .max(MAX_LIMIT)
      .optional()
      .describe(`How many periods to return, 1 to ${MAX_LIMIT} (default ${DEFAULT_LIMIT})`),
    offset: z.number().int().min(0).optional().describe('How many of the newest periods to skip (default 0)'),
  },
  run: async ({ userId, args }) => {
    const all = await listPeriods({ userId, planId: args.planId });
    const newestFirst = all.toReversed();
    const offset = args.offset ?? 0;

    return { periods: newestFirst.slice(offset, offset + (args.limit ?? DEFAULT_LIMIT)), total: all.length };
  },
});
