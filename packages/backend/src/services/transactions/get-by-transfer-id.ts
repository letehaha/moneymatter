import * as Transactions from '@models/transactions.model';
import { getAccessibleAccountIdsForUser } from '@services/sharing/auth/get-accessible-account-ids.service';

import { withTransaction } from '../common/with-transaction';

/**
 * Returns both legs of a transfer that the caller can see. Visibility is scoped by
 * account access (owned + per-resource shares + household shares) rather than by who
 * authored each row — the inviter and the recipient have different `userId`s on the
 * `Transactions` row but should each see the full pair on a shared account.
 */
export const getTransactionsByTransferId = withTransaction(
  async ({ transferId, userId }: { transferId: string; userId: number }) => {
    const accessibleAccountIds = await getAccessibleAccountIdsForUser({ userId });
    return Transactions.getTransactionsByTransferId({
      transferId,
      accountIds: accessibleAccountIds,
      include: Transactions.fullTransactionIncludes(),
    });
  },
);
