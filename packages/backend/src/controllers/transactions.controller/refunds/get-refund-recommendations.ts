import { TRANSACTION_TYPES } from '@bt/shared/types';
import { booleanQuery, dateBound, recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { serializeTransactions } from '@root/serializers';
import { getRefundRecommendations } from '@services/tx-refunds/get-refund-recommendations.service';
import { z } from 'zod';

import { isRefundPivotPaired, refundPivotPairIssue } from '../transaction-filters';

const schema = z.object({
  query: z
    .object({
      // Option 1: Provide transaction ID - backend derives everything
      transactionId: recordId().optional(),
      // Option 2: form data of a transaction being created. `transactionType` is the type of
      // that transaction itself; candidates are always of the opposite type.
      transactionType: z.enum(Object.values(TRANSACTION_TYPES) as [string, ...string[]]).optional(),
      originAmount: z.preprocess((val) => (val ? Number(val) : undefined), z.number().positive().optional()),
      accountId: recordId().optional(),
      includeRefundedAmount: booleanQuery().optional(),
      // Role of the requested transaction relative to the candidates: 'refund' lists rows it
      // could refund, 'original' lists rows that could refund it. Without it the pivot bounds
      // decide per row, and without those too 'refund' is assumed.
      refundRole: z.enum(['refund', 'original']).optional(),
      refundPivotFrom: dateBound({ precision: 'datetime' }).optional(),
      refundPivotTo: dateBound({ precision: 'datetime' }).optional(),
    })
    .refine(
      (data) => {
        // Either transactionId OR all form fields must be provided
        const hasTransactionId = data.transactionId !== undefined;
        const hasFormData =
          data.transactionType !== undefined && data.originAmount !== undefined && data.accountId !== undefined;
        return hasTransactionId || hasFormData;
      },
      {
        message: 'Either transactionId OR (transactionType, originAmount, accountId) must be provided',
      },
    )
    .refine(isRefundPivotPaired, refundPivotPairIssue),
});

export default createController(schema, async ({ user, query }) => {
  const transactions = await getRefundRecommendations({ userId: user.id, ...query });

  return { data: serializeTransactions(transactions) };
});
