import type { ReconciliationActionResponse, RecordId } from '@bt/shared/types';
import { withTransaction } from '@services/common/with-transaction';

import { detachLinks, loadReconcilableRows, scheduleRevalueOfAccounts, softDeleteTransactions } from './helpers';

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
    await scheduleRevalueOfAccounts({ rows });

    return { removedIds };
  },
);
