import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { deleteGoal } from '@services/goals/delete-goal';

import { defineTool } from '../define-tool';

export const deleteGoalTool = defineTool({
  name: 'delete_goal',
  toolset: 'budget-plans',
  access: 'delete',
  feature: FEATURES.goals,
  description:
    'Permanently delete a savings goal and free its account shares. Accounts and balances are not touched. Prefer update_goal with status archived to keep it. Returns { success: true }.',
  input: {
    goalId: recordId().describe('ID of the goal to delete'),
  },
  run: async ({ userId, args }) => {
    await deleteGoal({ userId, goalId: args.goalId });

    return { success: true };
  },
});
