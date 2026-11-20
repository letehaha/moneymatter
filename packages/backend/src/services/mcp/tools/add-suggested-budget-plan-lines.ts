import { FEATURES } from '@bt/shared/types';
import { budgetSuggestionAnswers, recordId } from '@common/lib/zod/custom-types';
import { addSuggestedLines } from '@services/budget-plans/suggested-lines';

import { defineTool } from '../define-tool';

export const addSuggestedBudgetPlanLinesTool = defineTool({
  name: 'add_suggested_budget_plan_lines',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.budget_plan,
  description:
    "Draft starter lines (and groups) for a budget plan from the spending history of its accounts, skipping categories another line already covers. It may use the server's AI to arrange the lines; without it the lines come from the spending ranking or a fixed starter set and only answers.detail is honoured (answersIgnored: true in the result). This can take a while. Returns { created, answersIgnored? }; created: 0 means there was nothing to suggest. Needs a plan that includes budget plans.",
  input: {
    planId: recordId().describe('Budget plan ID (from list_budget_plans)'),
    answers: budgetSuggestionAnswers()
      .optional()
      .describe(
        'Answers that steer the suggested lines. The accepted keys are listed in this schema; focusCategoryIds come from get_budget_plan_suggestion_context',
      ),
  },
  run: ({ userId, args }) => addSuggestedLines({ userId, planId: args.planId, answers: args.answers }),
});
