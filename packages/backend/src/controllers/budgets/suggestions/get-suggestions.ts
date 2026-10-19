import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransaction } from '@root/serializers';
import { getTrackerSuggestions } from '@services/budgets/smart-tracking/get-suggestions';
import { z } from 'zod';

export default createController(z.object({ params: z.object({ id: recordId() }) }), async ({ user, params }) => {
  const result = await getTrackerSuggestions({ userId: user.id, budgetId: params.id });

  return {
    data: {
      ...result,
      pending: result.pending.map((suggestion) => ({
        ...suggestion,
        transaction: serializeTransaction(suggestion.transaction),
      })),
    },
  };
});
