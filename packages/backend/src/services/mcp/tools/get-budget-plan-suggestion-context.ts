import { recordId } from '@common/lib/zod/custom-types';
import { getSuggestionContext } from '@services/budget-plans/suggested-lines';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const getBudgetPlanSuggestionContextTool = defineTool({
  name: 'get_budget_plan_suggestion_context',
  toolset: 'budget-plans',
  access: 'read',
  description:
    'Read what a new budget plan could start from, before creating one: the top spending categories of the given accounts over the last three full months. Returns { hasHistory, categories: [{ id, monthlyAvg }] }, monthlyAvg being the average per month in the base currency as a decimal. Without history (or without accountIds), hasHistory is false and the categories are a starter set with monthlyAvg null. Nothing is created.',
  input: {
    accountIds: z
      .array(recordId())
      .optional()
      .describe(
        'Accounts whose last three full months of spending are read (from get_accounts). Omit: no history is read',
      ),
  },
  run: ({ userId, args }) => getSuggestionContext({ userId, accountIds: args.accountIds ?? [] }),
});
