import { createController } from '@controllers/helpers/controller-factory';
import * as transactionsService from '@services/transactions/bulk-delete';
import { resolveBulkTargetIds } from '@services/transactions/matching-transactions';
import { z } from 'zod';

import { bulkTargetFields, bulkTargetIssue, hasOneBulkTarget, toBulkTarget } from './transaction-filters';

const schema = z.object({
  body: z.object(bulkTargetFields).refine(hasOneBulkTarget, bulkTargetIssue),
});

export default createController(schema, async ({ user, body }) => {
  const userId = user.id;
  const transactionIds = await resolveBulkTargetIds({ userId, ...toBulkTarget(body) });

  const result = await transactionsService.bulkDelete({ userId, transactionIds });

  return { data: result };
});
