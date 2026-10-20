import { createController } from '@controllers/helpers/controller-factory';
import { createInvestmentTransaction } from '@services/investments/transactions/create.service';
import { z } from 'zod';

import { createInvestmentTransactionBodySchema } from './schemas';

export default createController(z.object({ body: createInvestmentTransactionBodySchema }), async ({ user, body }) => {
  const tx = await createInvestmentTransaction({ userId: user.id, ...body });
  return { data: tx, statusCode: 201 };
});
