import type { RecordId } from '@bt/shared/types';
import type { ReconciliationActionResponse } from '@bt/shared/types/endpoints';
import { withTransaction } from '@services/common/with-transaction';

import { detachLinks, loadReconcilableRows, softDeleteTransactions } from './helpers';

export const removeTransactions = withTransaction(
  async ({
    userId,
    transactionIds,
  }: {
    userId: number;
    transactionIds: RecordId[];
  }): Promise<ReconciliationActionResponse> => {
    const rows = await loadReconcilableRows({ userId, transactionIds });
    const removedIds = rows.map((row) => row.id);

    await detachLinks({ transactionIds: removedIds });
    await softDeleteTransactions({ userId, transactionIds: removedIds, mergedIntoId: null });

    return { removedIds };
  },
);
