import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getLoanView } from '@services/loans/get-loan-views.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }),
});

export default createController(schema, async ({ user, params }) => {
  return { data: await getLoanView({ userId: user.id, accountId: params.id }) };
});
