import { budgetSuggestionAnswers, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { addSuggestedLines } from '@services/budget-plans/suggested-lines';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ planId: recordId() }),
  body: budgetSuggestionAnswers().optional(),
});

export default createController(schema, async ({ user, params, body }) => {
  const data = await addSuggestedLines({ userId: user.id, planId: params.planId, answers: body });

  return { data };
});
