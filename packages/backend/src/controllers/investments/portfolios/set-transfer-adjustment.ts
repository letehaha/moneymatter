import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { setTransferAdjustment } from '@services/investments/portfolios/transfers';
import { z } from 'zod';

import { transferAdjustmentBodySchema } from './schemas';
import { serializeTransferResponse } from './serialize-transfer';

const schema = z.object({
  params: z.object({
    id: recordId(),
    transferId: recordId(),
  }),
  body: transferAdjustmentBodySchema,
});

export default createController(schema, async ({ user, params, body }) => {
  const transfer = await setTransferAdjustment({
    userId: user.id,
    transferId: params.transferId,
    isAdjustment: body.isAdjustment,
  });

  return { data: serializeTransferResponse({ transfer }) };
});
