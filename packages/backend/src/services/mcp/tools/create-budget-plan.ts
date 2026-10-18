import { FEATURES } from '@bt/shared/types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createPlan } from '@services/budget-plans/create-plan';
import { createPlanBodyFields, createPlanBodySchema } from '@services/budget-plans/zod-schemas';

import { presentBudgetPlanDetails } from './budget-plan-output';
import { assertBaseCurrencyUnlocked, getUserId, jsonContent, requireFeatureAccess, requireScope } from './helpers';

const inputSchema = {
  name: createPlanBodyFields.name.describe('Name of the plan, 1 to 200 characters, e.g. "Household"'),
  type: createPlanBodyFields.type.describe(
    'Plan type. Only "category_caps" exists: lines cap the spending of categories',
  ),
  cadence: createPlanBodyFields.cadence.describe(
    'Period length unit: "days" (a period every intervalN days), "months" (every intervalN months) or "semi_monthly" (two periods a month, split at the anchor day and secondAnchorDay)',
  ),
  intervalN: createPlanBodyFields.intervalN.describe(
    'Periods are this many days or months long (default 1). At most 366 for days, 12 for months; must be 1 for semi_monthly',
  ),
  anchorDate: createPlanBodyFields.anchorDate.describe(
    'A date a period starts on, YYYY-MM-DD. For months and semi_monthly its day of the month is the period start day',
  ),
  secondAnchorDay: createPlanBodyFields.secondAnchorDay.describe(
    'semi_monthly only: the day of the month (1-31) the second period starts on. It must be well apart from the anchor day',
  ),
  epochDate: createPlanBodyFields.epochDate.describe(
    'First day to budget from, YYYY-MM-DD. It snaps back to a period start. Not in the future, and only a limited time back. Default: the current period',
  ),
  accountIds: createPlanBodyFields.accountIds.describe(
    'Accounts the plan counts activity from (from get_accounts), at least one. Only your own accounts of categories a plan can attach',
  ),
  autoAttachAccounts: createPlanBodyFields.autoAttachAccounts.describe(
    'Attach accounts you create later to the plan automatically',
  ),
  carryPolicy: createPlanBodyFields.carryPolicy.describe(
    'What carries from a period to the next: "floor" (leftover only, overspending is not carried), "signed" (leftover and overspending) or "none"',
  ),
  poolEnabled: createPlanBodyFields.poolEnabled.describe(
    'Fund the plan from a pool of income that lines are assigned from, starting at the epoch',
  ),
  withSuggestedLines: createPlanBodyFields.withSuggestedLines.describe(
    'Also draft starter lines from the spending history of the accounts. This can take a while',
  ),
  suggestionAnswers: createPlanBodyFields.suggestionAnswers.describe(
    'Answers that steer the starter lines; used only with withSuggestedLines. The accepted keys are listed in this schema',
  ),
};

export function registerCreateBudgetPlan(server: McpServer) {
  server.registerTool(
    'create_budget_plan',
    {
      description:
        'Create a budget plan (the "Budget" in the app: period envelopes where money is assigned to lines, not the trackers behind create_budget). Only one plan can be active at a time: creating a second fails; delete the current one with delete_budget_plan first. Read the existing plans with list_budget_plans. Required: name, type, cadence, anchorDate, accountIds (at least one). The plan is in your base currency. Cadence, anchor, epoch and type cannot be changed afterwards. Optional: intervalN, secondAnchorDay (semi_monthly), epochDate, autoAttachAccounts, carryPolicy, poolEnabled, and withSuggestedLines (+ suggestionAnswers) to draft starter lines; suggestedLinesFailed in the result means the plan exists without them. Returns the plan with its accountIds and lines. Needs a plan that includes budget plans. Requires finance:write scope.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' });
      requireFeatureAccess({ extra, feature: FEATURES.budget_plan });
      await assertBaseCurrencyUnlocked({ userId });
      trackMcpToolUsed({ userId, tool: 'create_budget_plan', clientId: extra.authInfo?.clientId });

      const { suggestedLinesFailed, suggestionAnswersIgnored, ...details } = await createPlan({
        userId,
        ...createPlanBodySchema.parse(args),
      });

      return jsonContent({
        data: {
          ...presentBudgetPlanDetails({ details }),
          ...(suggestedLinesFailed ? { suggestedLinesFailed } : {}),
          ...(suggestionAnswersIgnored ? { suggestionAnswersIgnored } : {}),
        },
      });
    },
  );
}
