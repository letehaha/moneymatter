import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { updateInvestmentTransaction } from '@services/investments/transactions/update.service';
import { z } from 'zod';

import { updateInvestmentTransactionBodyShape } from './schemas';

export default createController(
  z.object({
    params: z.object({
      transactionId: recordId(),
    }),
    body: z.object(updateInvestmentTransactionBodyShape),
  }),
  async ({ user, params, body }) => {
    const transaction = await updateInvestmentTransaction({
      userId: user.id,
      transactionId: params.transactionId,
      ...body,
    });
    return { data: transaction };
  },
);
