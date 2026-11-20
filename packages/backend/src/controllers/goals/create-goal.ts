import { refineLogoFieldsOnCreate } from '@controllers/common/logo-fields.schema';
import { createController } from '@controllers/helpers/controller-factory';
import { createGoal } from '@services/goals/create-goal';
import { z } from 'zod';

import { goalFieldsShape } from './goal-fields.schema';

const schema = z.object({
  body: z.strictObject(goalFieldsShape).superRefine((data, ctx) => refineLogoFieldsOnCreate({ data, ctx })),
});

export default createController(schema, async ({ user, body }) => {
  const data = await createGoal({ userId: user.id, ...body });

  return { data, statusCode: 201 };
});
