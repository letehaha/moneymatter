import { FEATURES, GOAL_STATUSES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { goalFieldsShape } from '@controllers/goals/goal-fields.schema';
import { updateGoal } from '@services/goals/update-goal';
import { z } from 'zod';

import { defineTool } from '../define-tool';
import { goalsForMcp } from './helpers';

export const updateGoalTool = defineTool({
  name: 'update_goal',
  toolset: 'budget-plans',
  access: 'write',
  feature: FEATURES.goals,
  description:
    'Update a savings goal. Only passed fields change; accounts replaces the whole set. Use status to pause, archive or restore a goal. Fails when an account would pass 100% shared across non-archived goals, the new currency has no exchange rate, or fixed amounts alone fall short of the target. Needs the Goals feature on the plan or an active trial. Returns the goal in the get_goals shape.',
  input: {
    goalId: recordId().describe('ID of the goal to update'),
    name: goalFieldsShape.name.optional().describe('New goal name'),
    currencyCode: goalFieldsShape.currencyCode.optional().describe('New target currency (ISO 4217)'),
    targetAmount: goalFieldsShape.targetAmount.optional().describe('New target, decimal in the goal currency'),
    targetDate: goalFieldsShape.targetDate.describe('New deadline (yyyy-MM-dd). Pass null to remove it'),
    plannedMonthly: goalFieldsShape.plannedMonthly.describe(
      'New planned saving per month, decimal in the goal currency. Pass null to fall back to the historical pace',
    ),
    status: z
      .enum(GOAL_STATUSES)
      .optional()
      .describe(
        "active, paused or archived. Archiving frees the accounts' shares; restoring re-checks that every account stays within 100%",
      ),
    accounts: goalFieldsShape.accounts
      .optional()
      .describe(
        "Replaces the whole set of backing accounts, each { accountId, sharePercent } or { accountId, fixedAmount, fixedPosition? } as in create_goal. Each account's sharePercent values across non-archived goals cannot exceed 100%",
      ),
    reachedHoldDays: goalFieldsShape.reachedHoldDays.describe(
      'Days (0-365, default 30) after first reaching the target during which a dip below it still counts as reached. 0 follows the balance live',
    ),
  },
  run: async ({ userId, args: { goalId, ...fields } }) => {
    const goal = await updateGoal({ userId, goalId, ...fields });
    const [data] = await goalsForMcp({ userId, goals: [goal] });

    return data;
  },
});
