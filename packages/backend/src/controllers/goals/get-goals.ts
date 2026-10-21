import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getGoal as getGoalService, listGoals as listGoalsService } from '@services/goals/get-goals';
import { z } from 'zod';

export const listGoals = createController(z.object({}), async ({ user }) => ({
  data: await listGoalsService({ userId: user.id }),
}));

export const getGoal = createController(
  z.object({ params: z.object({ goalId: recordId() }) }),
  async ({ user, params }) => ({ data: await getGoalService({ userId: user.id, goalId: params.goalId }) }),
);
