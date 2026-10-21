import { GOAL_STATUSES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { refineLogoFields } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { updateGoal } from '@services/goals/update-goal';
import { z } from 'zod';

import { goalFieldsShape } from './goal-fields.schema';

const schema = z.object({
  params: z.object({ goalId: recordId() }),
  body: z
    .strictObject({ ...goalFieldsShape, status: z.enum(GOAL_STATUSES) })
    .partial()
    .superRefine((data, ctx) => refineLogoFields({ data, ctx })),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await updateGoal({ userId: user.id, goalId: params.goalId, ...body });

  return { data };
});
