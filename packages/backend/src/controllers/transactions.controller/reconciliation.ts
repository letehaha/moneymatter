import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getReconciliationHistory } from '@services/transactions/reconciliation/get-history';
import { mergeTransactions } from '@services/transactions/reconciliation/merge-transactions';
import { removeTransactions } from '@services/transactions/reconciliation/remove-transactions';
import { restoreTransactions } from '@services/transactions/reconciliation/restore-transactions';
import {
  checkStuckPendingWithBank,
  getStuckPending,
  keepAsBooked,
} from '@services/transactions/reconciliation/stuck-pending';
import { z } from 'zod';

import { reconciliationIdsBodySchema, reconciliationMergeBodySchema } from './reconciliation-schemas';

const idsBodySchema = z.object({ body: reconciliationIdsBodySchema });

export const removeController = createController(idsBodySchema, async ({ user, body }) => ({
  data: await removeTransactions({ userId: user.id, transactionIds: body.transactionIds }),
}));

export const mergeController = createController(
  z.object({ body: reconciliationMergeBodySchema }),
  async ({ user, body }) => ({
    data: await mergeTransactions({
      userId: user.id,
      transactionIds: body.transactionIds,
      survivorId: body.survivorId,
    }),
  }),
);

export const restoreController = createController(idsBodySchema, async ({ user, body }) => ({
  data: await restoreTransactions({ userId: user.id, transactionIds: body.transactionIds }),
}));

export const historyController = createController(z.object({}), async ({ user }) => ({
  data: await getReconciliationHistory({ userId: user.id }),
}));

export const stuckPendingController = createController(z.object({}), async ({ user }) => ({
  data: await getStuckPending({ userId: user.id }),
}));

export const checkStuckPendingController = createController(
  z.object({ body: z.object({ accountId: recordId() }) }),
  async ({ user, body }) => ({
    data: await checkStuckPendingWithBank({ userId: user.id, accountId: body.accountId }),
  }),
);

export const keepAsBookedController = createController(idsBodySchema, async ({ user, body }) => ({
  data: await keepAsBooked({ userId: user.id, transactionIds: body.transactionIds }),
}));
