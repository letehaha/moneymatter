import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getTransactionVentureLink } from '@services/venture/linking/get-transaction-venture-link.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({
    transactionId: recordId(),
  }),
});

export default createController(schema, async ({ user, params }) => {
  const result = await getTransactionVentureLink({
    userId: user.id,
    transactionId: params.transactionId,
  });

  return { data: result };
});
