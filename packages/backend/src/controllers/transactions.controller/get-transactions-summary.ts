import { createController } from '@controllers/helpers/controller-factory';
import { getTransactionsSummary } from '@services/transactions/matching-transactions';
import { z } from 'zod';

import { toServiceFilters, transactionFiltersSchema } from './transaction-filters';

const schema = z.object({
  query: transactionFiltersSchema,
});

export default createController(schema, async ({ user, query }) => {
  const data = await getTransactionsSummary({ ...toServiceFilters(query), userId: user.id });

  return { data };
});
