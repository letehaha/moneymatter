import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeRefundTransaction } from '@root/serializers';
import { getRefund as getRefundService } from '@services/tx-refunds/get-refund.service';
import { z } from 'zod';

const schema = z.object({
  query: z.object({
    originalTxId: recordId(),
    refundTxId: recordId(),
  }),
});

export default createController(schema, async ({ user, query }) => {
  const { id: userId } = user;

  const refund = await getRefundService({
    originalTxId: query.originalTxId,
    refundTxId: query.refundTxId,
    userId,
  });

  // Serialize: Money amounts to API decimals
  return { data: serializeRefundTransaction(refund) };
});
