import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransaction } from '@root/serializers';
import { getTrackerSuggestions } from '@services/trackers/smart-tracking/get-suggestions';
import { z } from 'zod';

const serializeSuggestions = <T extends { transaction: Parameters<typeof serializeTransaction>[0] }>({
  suggestions,
}: {
  suggestions: T[];
}) => suggestions.map((suggestion) => ({ ...suggestion, transaction: serializeTransaction(suggestion.transaction) }));

export default createController(z.object({ params: z.object({ id: recordId() }) }), async ({ user, params }) => {
  const result = await getTrackerSuggestions({ userId: user.id, trackerId: params.id });

  return {
    data: {
      ...result,
      pending: serializeSuggestions({ suggestions: result.pending }),
      rejected: serializeSuggestions({ suggestions: result.rejected }),
    },
  };
});
