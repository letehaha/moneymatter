import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeBudget } from '@root/serializers';
import { duplicateBudget } from '@services/budgets/duplicate-budget';
import { z } from 'zod';

export default createController(z.object({ params: z.object({ id: recordId() }) }), async ({ user, params }) => {
  const budget = await duplicateBudget({ userId: user.id, id: params.id });

  return { data: serializeBudget(budget), statusCode: 201 };
});
