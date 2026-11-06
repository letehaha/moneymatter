import { recordId } from '@common/lib/zod/custom-types';
import { Money } from '@common/types/money';
import { createController } from '@controllers/helpers/controller-factory';
import { createSingleRefund } from '@services/tx-refunds/create-single-refund.service';
import { z } from 'zod';

import { atLeastOneCentAmountSchema } from '../schemas';

const schema = z.object({
  body: z.object({
    originalTxId: recordId().nullable(),
    refundTxId: recordId(),
    // Optional: when provided, the refund targets a specific split of the original transaction
    splitId: recordId().optional(),
    // Share of the refund transaction this link covers; omitted means the whole refund
    amount: atLeastOneCentAmountSchema().optional(),
  }),
});

export default createController(schema, async ({ user, body }) => {
  const { id: userId } = user;
  const { originalTxId, refundTxId, splitId, amount } = body;

  const data = await createSingleRefund({
    originalTxId,
    refundTxId,
    userId,
    splitId,
    amount: amount === undefined ? undefined : Money.fromDecimal(amount),
  });

  return { data };
});
