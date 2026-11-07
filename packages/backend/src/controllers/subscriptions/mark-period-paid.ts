import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { markPeriodPaid } from '@services/subscriptions/mark-period-paid';
import { z } from 'zod';

import { markPeriodPaidBodySchema } from './shared-schemas';

const schema = z.object({
  params: z.object({
    id: recordId(),
    periodId: recordId(),
  }),
  body: markPeriodPaidBodySchema.optional(),
});

export default createController(schema, async ({ user, params, body }) => {
  const period = await markPeriodPaid({
    userId: user.id,
    subscriptionId: params.id,
    periodId: params.periodId,
    transactionId: body?.transactionId,
    notes: body?.notes,
    createTransaction: body?.createTransaction,
    amount: body?.amount,
    time: body?.time,
    accountId: body?.accountId,
  });

  return { data: period };
});
