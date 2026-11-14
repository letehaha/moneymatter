import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { reconcileDuplicatesForAccount } from '@root/services/bank-data-providers/enablebanking/reconcile-duplicates';
import { z } from 'zod';

export default createController(
  z.object({
    params: z.object({
      connectionId: recordId(),
    }),
    body: z.object({
      accountId: recordId(),
    }),
  }),
  async ({ user, params, body }) => {
    const result = await reconcileDuplicatesForAccount({
      connectionId: params.connectionId,
      userId: user.id,
      accountId: body.accountId,
    });

    return { data: result };
  },
);
