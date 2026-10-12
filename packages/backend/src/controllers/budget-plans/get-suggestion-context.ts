import { commaSeparatedRecordIds } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getSuggestionContext } from '@services/budget-plans/suggested-lines';
import { z } from 'zod';

const schema = z.object({
  query: z.object({ accountIds: commaSeparatedRecordIds.optional() }),
});

export default createController(schema, async ({ user, query }) => {
  const data = await getSuggestionContext({ userId: user.id, accountIds: query.accountIds ?? [] });

  return { data };
});
