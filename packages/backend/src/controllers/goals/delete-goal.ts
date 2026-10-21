import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { deleteGoal } from '@services/goals/delete-goal';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ goalId: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  await deleteGoal({ userId: user.id, goalId: params.goalId });
});
